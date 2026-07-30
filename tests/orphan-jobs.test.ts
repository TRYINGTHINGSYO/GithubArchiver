import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	maybeReconcileStaleJobRuns,
	resetDaemonCadenceForTests
} from '$lib/server/daemon-cadence';
import { getDb } from '$lib/server/db/connection';
import {
	getJobRunById,
	orphanJobAgeMs,
	reconcileOrphanedJobRuns,
	startJobRun
} from '$lib/server/db/jobs';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('orphan job reconciliation', () => {
	beforeEach(() => {
		setupTestDb();
		resetDaemonCadenceForTests();
		delete process.env.ORPHAN_JOB_AGE_MS;
		delete process.env.DAEMON_RECONCILE_INTERVAL_MS;
	});
	afterEach(() => teardownTestDb());

	it('marks stale running jobs interrupted on age-based reconcile', () => {
		const nowMs = Date.parse('2026-07-07T10:00:00.000Z');
		const staleStarted = new Date(nowMs - 20 * 60 * 1000).toISOString();
		const db = getDb();

		db.prepare(
			`INSERT INTO job_runs (job_type, status, started_at, detail_json)
			 VALUES ('enrich', 'running', ?, '{}')`
		).run(staleStarted);

		const freshId = startJobRun('enrich', { test: true });
		db.prepare(`UPDATE job_runs SET started_at = ? WHERE id = ?`).run(
			new Date(nowMs - 2 * 60 * 1000).toISOString(),
			freshId
		);

		const reconciled = reconcileOrphanedJobRuns(10 * 60 * 1000, nowMs);
		expect(reconciled).toBe(1);

		const stale = db.prepare('SELECT status, error, reason FROM job_runs WHERE started_at = ?').get(
			staleStarted
		) as { status: string; error: string; reason: string };
		expect(stale.status).toBe('interrupted');
		expect(stale.error).toContain('orphaned');
		expect(stale.reason).toContain('orphaned');

		const fresh = db.prepare('SELECT status FROM job_runs WHERE id = ?').get(freshId) as {
			status: string;
		};
		expect(fresh.status).toBe('running');
	});

	it('boot reconcile (maxAgeMs=0) reclaims crash orphans younger than the periodic ceiling', () => {
		const nowMs = Date.parse('2026-07-30T10:06:00.000Z');
		const db = getDb();
		// Mirrors prod #364183/#364184: started ~7m before deploy boot, under old 10m floor.
		const crashStarted = new Date(nowMs - 7 * 60 * 1000).toISOString();
		db.prepare(
			`INSERT INTO job_runs (job_type, status, started_at, detail_json)
			 VALUES ('ingest', 'running', ?, '{"daemon_action":"ingest"}'),
			        ('ingest', 'running', ?, '{"current_hour":"2026-07-25-02","phase":"starting"}')`
		).run(crashStarted, crashStarted);

		expect(reconcileOrphanedJobRuns(10 * 60 * 1000, nowMs)).toBe(0);

		const boot = reconcileOrphanedJobRuns(0, nowMs, {
			reason: 'orphaned: process restarted mid-run'
		});
		expect(boot).toBe(2);

		const left = db
			.prepare(`SELECT COUNT(*) AS c FROM job_runs WHERE status = 'running'`)
			.get() as { c: number };
		expect(left.c).toBe(0);
	});

	it('periodic safety net closes a stuck running row inserted only via the DB', () => {
		const nowMs = Date.parse('2026-07-30T18:00:00.000Z');
		const db = getDb();
		const started = new Date(nowMs - orphanJobAgeMs() - 1000).toISOString();
		db.prepare(
			`INSERT INTO job_runs (job_type, status, started_at, detail_json)
			 VALUES ('ingest', 'running', ?, '{"planted":true}')`
		).run(started);

		const liveDaemon = startJobRun('daemon', { in_process: true });
		db.prepare(`UPDATE job_runs SET started_at = ? WHERE id = ?`).run(
			new Date(nowMs - 60_000).toISOString(),
			liveDaemon
		);

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = maybeReconcileStaleJobRuns({
			now: nowMs,
			force: true,
			excludeIds: [liveDaemon],
			maxAgeMs: orphanJobAgeMs()
		});
		expect(result.ran).toBe(true);
		expect(result.reconciled).toBe(1);
		expect(getJobRunById(result.ids[0]!)?.status).toBe('interrupted');
		expect(getJobRunById(liveDaemon)?.status).toBe('running');
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SAFETY NET'));
		errorSpy.mockRestore();
	});

	it('periodic reconcile does not steal a fresh running job under the ceiling', () => {
		const nowMs = Date.parse('2026-07-30T18:00:00.000Z');
		const freshId = startJobRun('ingest', { hours_planned: 1 });
		getDb()
			.prepare(`UPDATE job_runs SET started_at = ? WHERE id = ?`)
			.run(new Date(nowMs - 60_000).toISOString(), freshId);

		const result = maybeReconcileStaleJobRuns({
			now: nowMs,
			force: true,
			maxAgeMs: orphanJobAgeMs()
		});
		expect(result.reconciled).toBe(0);
		expect(getJobRunById(freshId)?.status).toBe('running');
	});
});
