import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	computeIngestTimeoutBackoffMs,
	ingestTimeoutBackoffBaseMs
} from '$lib/server/ingest-hour-backoff';
import {
	clearHourFetchBackoff,
	getIngestHourBackoff,
	isHourInFetchBackoff,
	recordHourFetchFailure
} from '$lib/server/db/ingest-hour-backoff';
import {
	countMissingGhArchiveHours,
	listMissingHourKeys,
	recordHourIngested
} from '$lib/server/db/ingestion';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('ingest hour timeout backoff', () => {
	beforeEach(() => {
		setupTestDb();
		delete process.env.INGEST_TIMEOUT_BACKOFF_BASE_MS;
		delete process.env.DAEMON_INGEST_FROM;
		delete process.env.DAEMON_INGEST_MAX_HOURS;
	});
	afterEach(() => teardownTestDb());

	it('uses markJobFailed-shaped exponential backoff capped at 8x base', () => {
		const base = 15 * 60_000;
		expect(computeIngestTimeoutBackoffMs(1, base)).toBe(base);
		expect(computeIngestTimeoutBackoffMs(2, base)).toBe(base * 2);
		expect(computeIngestTimeoutBackoffMs(3, base)).toBe(base * 4);
		expect(computeIngestTimeoutBackoffMs(5, base)).toBe(base * 8);
		expect(computeIngestTimeoutBackoffMs(10, base)).toBe(base * 8);
		expect(ingestTimeoutBackoffBaseMs()).toBe(15 * 60_000);
	});

	it('skips backed-off hours from attempt batch but keeps them in planner count', () => {
		const nowMs = Date.parse('2026-07-30T18:00:00.000Z');
		process.env.DAEMON_INGEST_FROM = '2026-07-25-17';
		process.env.DAEMON_INGEST_MAX_HOURS = '6';
		process.env.INGEST_TIMEOUT_BACKOFF_BASE_MS = String(15 * 60_000);

		// Seed a success so range start is established; leave 18/19/20 missing.
		recordHourIngested('2026-07-25-17', {
			events: 1,
			inserted: 1,
			skipped: 0,
			matchedRepoCreates: 1
		});

		const before = listMissingHourKeys(6, nowMs);
		expect(before[0]).toBe('2026-07-25-18');
		expect(before).toContain('2026-07-25-19');

		recordHourFetchFailure(
			'2026-07-25-18',
			'GH Archive fetch timed out after 30000ms',
			nowMs
		);
		recordHourFetchFailure(
			'2026-07-25-19',
			'GH Archive fetch timed out after 30000ms',
			nowMs
		);

		expect(isHourInFetchBackoff('2026-07-25-18', nowMs)).toBe(true);
		expect(isHourInFetchBackoff('2026-07-25-18', nowMs + 15 * 60_000 + 1)).toBe(false);

		const attempt = listMissingHourKeys(6, nowMs);
		expect(attempt).not.toContain('2026-07-25-18');
		expect(attempt).not.toContain('2026-07-25-19');
		expect(attempt[0]).toBe('2026-07-25-20');

		const count = countMissingGhArchiveHours(nowMs);
		expect(count).toBeGreaterThan(attempt.length);
		// Sticky hours still count as missing for planner priority.
		expect(count).toBeGreaterThanOrEqual(2);
	});

	it('escalates consecutive failures and clears on successful ingest', () => {
		const nowMs = Date.parse('2026-07-30T18:00:00.000Z');
		process.env.INGEST_TIMEOUT_BACKOFF_BASE_MS = String(60_000);

		const first = recordHourFetchFailure('2026-07-25-18', 'timeout', nowMs);
		expect(first.consecutive_failures).toBe(1);
		expect(Date.parse(first.next_retry_at) - nowMs).toBe(60_000);

		const second = recordHourFetchFailure('2026-07-25-18', 'timeout again', nowMs + 1000);
		expect(second.consecutive_failures).toBe(2);
		expect(Date.parse(second.next_retry_at) - (nowMs + 1000)).toBe(120_000);

		recordHourIngested('2026-07-25-18', {
			events: 10,
			inserted: 1,
			skipped: 0,
			matchedRepoCreates: 1
		});
		expect(getIngestHourBackoff('2026-07-25-18')).toBeNull();
		expect(isHourInFetchBackoff('2026-07-25-18', nowMs + 10_000)).toBe(false);
	});

	it('clearHourFetchBackoff is idempotent for unknown hours', () => {
		clearHourFetchBackoff('never-seen');
		expect(getIngestHourBackoff('never-seen')).toBeNull();
	});
});
