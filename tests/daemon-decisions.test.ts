import { describe, expect, it } from 'vitest';
import {
	isUnexpectedIdleWithBacklog,
	isRateLimitIdleReason
} from '$lib/server/db/daemon-decisions';
import { hasAnyBacklog, pickAction, type BacklogSnapshot } from '$lib/server/daemon-planner';

function backlog(overrides: Partial<BacklogSnapshot> = {}): BacklogSnapshot {
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

describe('daemon-decisions', () => {
	it('treats rate-limit idle with backlog as expected, not a planner bug', () => {
		const until = new Date(Date.now() + 60_000).toISOString();
		const b = backlog({ unenriched: 50_000, rateLimitedUntil: until });
		const decision = pickAction(b);
		expect(decision.action).toBe('idle');
		expect(isRateLimitIdleReason(decision.reason)).toBe(true);
		expect(isUnexpectedIdleWithBacklog(decision.action, decision.reason, b)).toBe(false);
	});

	it('flags idle with backlog when not rate limited as unexpected', () => {
		const b = backlog({ unenriched: 10_000 });
		expect(isUnexpectedIdleWithBacklog('idle', 'All queues empty', b)).toBe(true);
	});

	it('never produces unexpected idle from pickAction when backlog exists without rate limit', () => {
		const cases: Partial<BacklogSnapshot>[] = [
			{ unenriched: 1 },
			{ staleRefresh: 1 },
			{ unarchivedSource: 1 },
			{ missingGhArchiveHours: 1 },
			{ backfillPendingHours: 1 },
			{ currentHourSearchGap: true },
			{ unenriched: 99_000, missingGhArchiveHours: 3 }
		];

		for (const overrides of cases) {
			const b = backlog(overrides);
			const decision = pickAction(b);
			expect(isUnexpectedIdleWithBacklog(decision.action, decision.reason, b)).toBe(false);
		}
	});

	it('hasAnyBacklog matches summarize idle-with-backlog detection', () => {
		expect(hasAnyBacklog(backlog({ unenriched: 1 }))).toBe(true);
		expect(hasAnyBacklog(backlog())).toBe(false);
	});
});
