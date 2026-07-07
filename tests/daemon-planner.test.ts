import { describe, expect, it } from 'vitest';
import {
	computeDaemonSleepMs,
	hasAnyBacklog,
	pickAction,
	rankActions,
	scoreAction,
	type BacklogSnapshot
} from '$lib/server/daemon-planner';

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

	it('prefers archive over enrich when unarchived source backlog exists', () => {
		const backlog = emptyBacklog({ unenriched: 109_000, unarchivedSource: 5_050 });
		const decision = pickAction(backlog);
		expect(decision.action).toBe('archive');
		expect(decision.reason).toContain('archive');
	});

	it('scores archive above enrich at any realistic combined backlog', () => {
		const backlog = emptyBacklog({ unenriched: 1_000_000, unarchivedSource: 1 });
		expect(scoreAction('archive', backlog)).toBeGreaterThan(scoreAction('enrich', backlog));
	});

	it('prefers ingest over archive when missing hours exist', () => {
		const backlog = emptyBacklog({ missingGhArchiveHours: 1, unarchivedSource: 5_000 });
		expect(scoreAction('archive', backlog)).toBeGreaterThan(scoreAction('enrich', backlog));
		expect(pickAction(backlog).action).toBe('ingest');
	});

	it('prefers ingest over enrich when missing hours exist even with huge unenriched backlog', () => {
		const backlog = emptyBacklog({ missingGhArchiveHours: 2, unenriched: 50_000 });
		expect(pickAction(backlog).action).toBe('ingest');
	});

	it('prefers backfill over enrich when both are backlogged', () => {
		const backlog = emptyBacklog({ backfillPendingHours: 50, unenriched: 5000 });
		expect(pickAction(backlog).action).toBe('backfill');
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

	it('scores ingest above enrich at any realistic backlog size', () => {
		const backlog = emptyBacklog({ missingGhArchiveHours: 1, unenriched: 1_000_000 });
		expect(scoreAction('ingest', backlog)).toBeGreaterThan(scoreAction('enrich', backlog));
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
			backlog: emptyBacklog({ unenriched: 10_000 }),
			hadFailure: false,
			failureStreak: 0,
			sleepMinMs: SLEEP_MIN,
			sleepMaxMs: SLEEP_MAX,
			backoffBaseMs: 60_000,
			backoffMaxMs: SLEEP_MAX,
			idleSleepMs: SLEEP_MAX
		});
		expect(ms).toBe(SLEEP_MIN);
		expect(ms).toBeLessThan(SLEEP_MAX);
	});

	it('uses short sleep on failure when backlog remains', () => {
		const ms = computeDaemonSleepMs({
			backlog: emptyBacklog({ staleRefresh: 500 }),
			hadFailure: true,
			failureStreak: 2,
			sleepMinMs: SLEEP_MIN,
			sleepMaxMs: SLEEP_MAX,
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
