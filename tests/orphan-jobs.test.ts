import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { reconcileOrphanedJobRuns, startJobRun } from '$lib/server/db/jobs';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('orphan job reconciliation', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('marks stale running jobs interrupted on startup reconcile', () => {
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
});
