import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import {
	getLongestRunningWorkJobSnapshot,
	listRunningWorkJobs,
	staleRunningJobAgeMs,
	startJobRun
} from '$lib/server/db/jobs';
import { formatDurationCompact } from '$lib/utils';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('formatDurationCompact', () => {
	it('formats seconds, minutes, and hours', () => {
		expect(formatDurationCompact(5_000)).toBe('5s');
		expect(formatDurationCompact(12 * 60_000)).toBe('12m');
		expect(formatDurationCompact(75 * 60_000)).toBe('1h 15m');
		expect(formatDurationCompact(2 * 60 * 60_000)).toBe('2h');
	});
});

describe('running work job age snapshot', () => {
	beforeEach(() => {
		setupTestDb();
		delete process.env.STALE_RUNNING_JOB_MS;
	});
	afterEach(() => teardownTestDb());

	it('ignores the long-lived daemon row', () => {
		startJobRun('daemon', { pid: 1 });
		expect(listRunningWorkJobs()).toHaveLength(0);
		expect(getLongestRunningWorkJobSnapshot()).toBeNull();
	});

	it('reports age and stale flag for the longest-running work job', () => {
		const nowMs = Date.parse('2026-07-30T09:15:00.000Z');
		const db = getDb();

		const ingestId = startJobRun('ingest', { hours_planned: 6 });
		db.prepare(`UPDATE job_runs SET started_at = ? WHERE id = ?`).run(
			'2026-07-30T08:00:00.000Z',
			ingestId
		);
		startJobRun('enrich', { burst: true });

		const snap = getLongestRunningWorkJobSnapshot(nowMs);
		expect(snap).not.toBeNull();
		expect(snap!.jobType).toBe('ingest');
		expect(snap!.id).toBe(ingestId);
		expect(snap!.ageLabel).toBe('1h 15m');
		expect(snap!.ageMs).toBe(75 * 60_000);
		expect(snap!.stale).toBe(true);
		expect(snap!.runningCount).toBe(2);
		expect(staleRunningJobAgeMs()).toBe(10 * 60_000);
	});

	it('is not stale when under the threshold', () => {
		const nowMs = Date.parse('2026-07-30T09:15:00.000Z');
		const id = startJobRun('enrich', {});
		getDb()
			.prepare(`UPDATE job_runs SET started_at = ? WHERE id = ?`)
			.run('2026-07-30T09:10:00.000Z', id);

		const snap = getLongestRunningWorkJobSnapshot(nowMs);
		expect(snap?.stale).toBe(false);
		expect(snap?.ageLabel).toBe('5m');
	});
});
