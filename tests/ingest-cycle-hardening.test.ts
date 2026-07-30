import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { getJobRunById } from '$lib/server/db/jobs';
import { ingestWallClockMs, isIngestCycleFailure, runIngestCycle } from '$lib/server/workers/ingest';
import { setupTestDb, teardownTestDb } from './helpers/db';

vi.mock('$ingest-core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$ingest-core')>();
	return {
		...actual,
		ingestHour: vi.fn()
	};
});

import { ingestHour } from '$ingest-core';

describe('ingest cycle wall-clock and job finish', () => {
	beforeEach(() => {
		setupTestDb();
		vi.mocked(ingestHour).mockReset();
		delete process.env.INGEST_WALL_CLOCK_MS;
		delete process.env.DAEMON_INGEST_MAX_HOURS;
	});
	afterEach(() => {
		teardownTestDb();
	});

	it('reads wall-clock from env with sane default', () => {
		expect(ingestWallClockMs()).toBe(10 * 60_000);
		process.env.INGEST_WALL_CLOCK_MS = '60000';
		expect(ingestWallClockMs()).toBe(60_000);
	});

	it('finishes job_run as failed when ingestHour throws (no orphan running row)', async () => {
		const db = getDb();
		db.prepare(
			`INSERT INTO ingestion_state (hour_key, ingested_at, events, matched_repo_creates, inserted, skipped, source)
			 VALUES ('2026-07-24-20', '2026-07-24T21:00:00.000Z', 1, 1, 1, 0, 'gharchive')`
		).run();

		vi.mocked(ingestHour).mockRejectedValueOnce(new Error('boom mid-cycle'));

		process.env.DAEMON_INGEST_MAX_HOURS = '1';
		const result = await runIngestCycle();

		expect(result.failed).toBeGreaterThan(0);
		expect(isIngestCycleFailure(result)).toBe(true);

		const running = db
			.prepare(`SELECT COUNT(*) AS c FROM job_runs WHERE status = 'running' AND job_type = 'ingest'`)
			.get() as { c: number };
		expect(running.c).toBe(0);

		const last = db
			.prepare(
				`SELECT id, status, error FROM job_runs WHERE job_type = 'ingest' ORDER BY id DESC LIMIT 1`
			)
			.get() as { id: number; status: string; error: string };
		expect(last.status).toBe('failed');
		expect(last.error).toContain('boom');
		expect(getJobRunById(last.id)?.finished_at).toBeTruthy();
	});

	it('stops early and marks failed when wall-clock deadline is already past', async () => {
		const db = getDb();
		db.prepare(
			`INSERT INTO ingestion_state (hour_key, ingested_at, events, matched_repo_creates, inserted, skipped, source)
			 VALUES ('2026-07-24-20', '2026-07-24T21:00:00.000Z', 1, 1, 1, 0, 'gharchive')`
		).run();

		process.env.DAEMON_INGEST_MAX_HOURS = '2';

		vi.mocked(ingestHour).mockImplementation(async (hourKey: string) => ({
			hourKey,
			url: `https://data.gharchive.org/${hourKey}.json.gz`,
			outcome: 'downloaded' as const,
			parsedEvents: 10,
			repoCreates: 1,
			inserted: 1,
			skipped: 0,
			source: 'gharchive' as const,
			retries: 0
		}));

		// Deadline = (now - 10s) + 1ms → already expired when the loop checks Date.now().
		const result = await runIngestCycle({
			nowMs: Date.now() - 10_000,
			wallClockMs: 1
		});

		expect(result.wallClockExceeded).toBe(true);
		expect(result.failed).toBeGreaterThan(0);
		expect(vi.mocked(ingestHour)).not.toHaveBeenCalled();

		const last = db
			.prepare(
				`SELECT status, error FROM job_runs WHERE job_type = 'ingest' ORDER BY id DESC LIMIT 1`
			)
			.get() as { status: string; error: string };
		expect(last.status).toBe('failed');
		expect(last.error).toContain('wall-clock');
	});
});
