import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hourKey } from '$lib/server/gharchive';
import {
	hoursSinceHourEnded,
	isHourWithinPublishGrace,
	shouldExcludeHourFromMissingBacklog
} from '$lib/server/gharchive-hours';
import { getDb } from '$lib/server/db/connection';
import {
	countMissingGhArchiveHours,
	listMissingHourKeys,
	recordHourUnavailable
} from '$lib/server/db/ingestion';
import { pickAction, scoreAction } from '$lib/server/daemon-planner';
import { queryBacklogSnapshot } from '$lib/server/daemon-backlog';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('gharchive-hours / missing backlog', () => {
	const nowMs = Date.parse('2026-07-07T09:30:00.000Z');

	it('treats a 404 on an hour less than 3 hours old as not yet published', () => {
		const recentHour = '2026-07-07-08'; // ended 09:00 UTC, 30m ago
		expect(hoursSinceHourEnded(recentHour, nowMs)).toBeLessThan(3);
		expect(isHourWithinPublishGrace(recentHour, nowMs)).toBe(true);
		expect(
			shouldExcludeHourFromMissingBacklog(
				recentHour,
				{ unavailable_at: '2026-07-07T09:05:00.000Z', http_status: 404 },
				nowMs
			)
		).toBe(true);
		expect(scoreAction('ingest', { missingGhArchiveHours: 0, currentHourSearchGap: false, backfillPendingHours: 0, unenriched: 50_000, staleRefresh: 0, unarchivedSource: 0, rateLimitedUntil: null })).toBe(0);
	});

	it('excludes same-day 404 hours from listMissingHourKeys', () => {
		setupTestDb();
		recordHourUnavailable('2026-07-07-02', 404);
		recordHourUnavailable('2026-07-07-03', 404);

		const missing = listMissingHourKeys(undefined, nowMs);
		expect(missing).not.toContain('2026-07-07-02');
		expect(missing).not.toContain('2026-07-07-03');
		teardownTestDb();
	});

	it('still includes older non-today 404 hours after retry cooldown', () => {
		setupTestDb();
		const db = getDb();
		const oldHour = hourKey(new Date(Date.UTC(2026, 6, 5, 10))); // 2026-07-05-10
		const oldAttempt = '2026-07-05T12:00:00.000Z';
		process.env.DAEMON_INGEST_FROM = oldHour;
		db.prepare(
			`INSERT INTO ingestion_state
			 (hour_key, ingested_at, events, inserted, skipped, source, unavailable_at, http_status)
			 VALUES (?, ?, 0, 0, 0, 'gharchive', ?, 404)`
		).run(oldHour, oldAttempt, oldAttempt);

		const missing = listMissingHourKeys(50, nowMs);
		expect(missing).toContain(oldHour);
		delete process.env.DAEMON_INGEST_FROM;
		teardownTestDb();
	});
});

describe('gharchive-hours', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => {
		delete process.env.DAEMON_INGEST_FROM;
		delete process.env.DAEMON_INGEST_MAX_HOURS;
		teardownTestDb();
	});

	it('listMissingHourKeys excludes publish-grace hours even without a prior attempt', () => {
		const nowMs = Date.parse('2026-07-07T09:30:00.000Z');
		const missing = listMissingHourKeys(undefined, nowMs);
		expect(missing).not.toContain('2026-07-07-08');
	});

	it('countMissingGhArchiveHours returns full filtered count without batch slice', () => {
		const nowMs = Date.parse('2026-07-07T09:30:00.000Z');
		process.env.DAEMON_INGEST_MAX_HOURS = '2';
		process.env.DAEMON_INGEST_FROM = '2026-07-07-00';

		expect(listMissingHourKeys(undefined, nowMs).length).toBeLessThanOrEqual(2);
		expect(countMissingGhArchiveHours(nowMs)).toBeGreaterThan(2);
	});

	it('grace-excluded hours yield missingGhArchiveHours=0 in pickAction path', () => {
		const nowMs = Date.parse('2026-07-07T09:30:00.000Z');
		process.env.DAEMON_INGEST_FROM = '2026-07-07-08';
		recordHourUnavailable('2026-07-07-08', 404);

		const snapshot = queryBacklogSnapshot({ nowMs });
		expect(snapshot.missingGhArchiveHours).toBe(0);
		expect(pickAction(snapshot, nowMs).action).not.toBe('ingest');
	});
});
