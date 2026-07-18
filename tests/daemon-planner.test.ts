import { describe, expect, it } from 'vitest';
import {
	computeDaemonSleepMs,
	hasAnyBacklog,
	pickAction,
	rankActions,
	scoreAction,
	type BacklogSnapshot
} from '$lib/server/daemon-planner';
import { getDueDaemonJobs } from '$lib/server/daemon-scheduler';

function emptyBacklog(overrides: Partial<BacklogSnapshot> = {}): BacklogSnapshot {
	return {
		missingGhArchiveHours: 0,
		currentHourSearchGap: false,
		backfillPendingHours: 0,
		unenriched: 0,
		staleRefresh: 0,
		unarchivedSource: 0,
		rateLimitedUntil: null,
		...overrides
	};
}

const SLEEP_MIN = 5_000;
const SLEEP_MAX = 900_000;

describe('daemon-planner', () => {
	it('picks enrich when unenriched dominates and archive backlog is empty', () => {
		const backlog = emptyBacklog({ unenriched: 6231, staleRefresh: 12 });
		const decision = pickAction(backlog);
		expect(decision.action).toBe('enrich');
		expect(decision.reason).toContain('enrich');
	});

	it('keeps ingest score positive with a huge enrichment backlog', () => {
		const backlog = emptyBacklog({ missingGhArchiveHours: 3, unenriched: 671_000 });
		expect(scoreAction('ingest', backlog)).toBeGreaterThan(0);
		expect(getDueDaemonJobs(Date.now(), { unenrichedCount: 671_000 })).toContain('ingest');
	});

	it('prefers ingest when missing hours dominate enrich score', () => {
		const backlog = emptyBacklog({ missingGhArchiveHours: 3, unenriched: 100 });
		expect(scoreAction('ingest', backlog)).toBeGreaterThan(scoreAction('enrich', backlog));
		expect(pickAction(backlog).action).toBe('ingest');
	});

	it('prefers enrich when there is backlog and no missing hours', () => {
		const backlog = emptyBacklog({ unenriched: 50_000 });
		expect(pickAction(backlog).action).toBe('enrich');
	});

	it('prefers archive when unarchived exists and enrich is empty', () => {
		const backlog = emptyBacklog({ unarchivedSource: 5_000 });
		expect(pickAction(backlog).action).toBe('archive');
	});

	it('returns idle when all queues are empty', () => {
		const decision = pickAction(emptyBacklog());
		expect(decision.action).toBe('idle');
		expect(decision.reason).toBe('All queues empty');
	});

	it('returns idle when rate limited', () => {
		const until = new Date(Date.now() + 60_000).toISOString();
		const decision = pickAction(emptyBacklog({ unenriched: 100, rateLimitedUntil: until }));
		expect(decision.action).toBe('idle');
		expect(decision.reason).toContain('rate limit');
	});

	it('scores enrich above refresh for the same magnitude', () => {
		const backlog = emptyBacklog({ unenriched: 1000, staleRefresh: 1000 });
		expect(scoreAction('enrich', backlog)).toBeGreaterThan(scoreAction('refresh', backlog));
	});

	it('hasAnyBacklog is false only when every queue is empty', () => {
		expect(hasAnyBacklog(emptyBacklog())).toBe(false);
		expect(hasAnyBacklog(emptyBacklog({ unarchivedSource: 1 }))).toBe(true);
	});

	it('rankActions sorts by descending score', () => {
		const ranked = rankActions(emptyBacklog({ unenriched: 100, staleRefresh: 50 }));
		expect(ranked[0]?.action).toBe('enrich');
		expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]?.score ?? 0);
	});

	it('uses short sleep while any backlog queue is non-empty', () => {
		const ms = computeDaemonSleepMs({
			backlog: emptyBacklog({ staleRefresh: 10_000, unenriched: 0 }),
			hadFailure: false,
			failureStreak: 0,
			sleepMinMs: SLEEP_MIN,
			sleepMaxMs: SLEEP_MAX,
			backlogSleepMs: SLEEP_MIN,
			backoffBaseMs: 60_000,
			backoffMaxMs: SLEEP_MAX,
			idleSleepMs: SLEEP_MAX
		});
		expect(ms).toBe(SLEEP_MIN);
	});

	it('uses near-continuous enrich sleep when unenriched backlog is large', () => {
		const ms = computeDaemonSleepMs({
			backlog: emptyBacklog({ unenriched: 670_000 }),
			hadFailure: false,
			failureStreak: 0,
			sleepMinMs: 300_000,
			sleepMaxMs: 900_000,
			backlogSleepMs: 60_000,
			enrichBacklogSleepMs: 2_000,
			enrichBacklogSleepThreshold: 100,
			backoffBaseMs: 60_000,
			backoffMaxMs: 900_000
		});
		expect(ms).toBe(2_000);
	});

	it('lets ARCHIVE_BACKLOG_SLEEP_MS win over a stale 5-minute sleepMin when enrich is quiet', () => {
		const ms = computeDaemonSleepMs({
			backlog: emptyBacklog({ unarchivedSource: 5_000, unenriched: 0 }),
			hadFailure: false,
			failureStreak: 0,
			sleepMinMs: 300_000,
			sleepMaxMs: 900_000,
			backlogSleepMs: 60_000,
			backoffBaseMs: 60_000,
			backoffMaxMs: 900_000
		});
		expect(ms).toBe(60_000);
	});

	it('caps sleep when unarchived source backlog is large', () => {
		const ms = computeDaemonSleepMs({
			backlog: emptyBacklog({ unarchivedSource: 50_000 }),
			hadFailure: false,
			failureStreak: 0,
			sleepMinMs: 300_000,
			sleepMaxMs: SLEEP_MAX,
			backoffBaseMs: 60_000,
			backoffMaxMs: SLEEP_MAX,
			archiveBacklogSleepMs: 60_000,
			archiveBacklogSleepThreshold: 1000
		});
		expect(ms).toBe(60_000);
	});

	it('uses short sleep on failure when backlog remains', () => {
		const ms = computeDaemonSleepMs({
			backlog: emptyBacklog({ staleRefresh: 500 }),
			hadFailure: true,
			failureStreak: 2,
			sleepMinMs: SLEEP_MIN,
			sleepMaxMs: SLEEP_MAX,
			backlogSleepMs: SLEEP_MIN,
			backoffBaseMs: 60_000,
			backoffMaxMs: SLEEP_MAX,
			idleSleepMs: SLEEP_MAX
		});
		expect(ms).toBe(SLEEP_MIN);
	});

	it('allows long idle sleep only when all queues are empty', () => {
		const ms = computeDaemonSleepMs({
			backlog: emptyBacklog(),
			hadFailure: false,
			failureStreak: 0,
			sleepMinMs: SLEEP_MIN,
			sleepMaxMs: SLEEP_MAX,
			backoffBaseMs: 60_000,
			backoffMaxMs: SLEEP_MAX,
			idleSleepMs: SLEEP_MAX
		});
		expect(ms).toBe(SLEEP_MAX);
	});
});
