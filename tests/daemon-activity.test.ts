import { describe, expect, it } from 'vitest';
import { formatActivityMessage, resolveDaemonActivity } from '$lib/server/daemon-activity';
import type { EnrichmentProgress } from '$lib/server/enrichment-progress';

function enrichment(overrides: Partial<EnrichmentProgress> = {}): EnrichmentProgress {
	return {
		status: 'idle',
		currentRepo: null,
		completed: 0,
		failed: 0,
		remaining: 0,
		backlogTotal: 0,
		enrichedTotal: 0,
		updatedAt: '2026-07-07T11:00:00.000Z',
		...overrides
	};
}

describe('daemon-activity', () => {
	it('formats active enrich message with live repo progress', () => {
		expect(
			formatActivityMessage(
				'enrich',
				50,
				true,
				enrichment({
					status: 'running',
					currentRepo: 'acme/widget',
					completed: 12,
					remaining: 38,
					enrichedTotal: 112
				})
			)
		).toBe('Enriching acme/widget — 12 done, 38 left');
	});

	it('reports rate-limited state with next check-in', () => {
		const activity = resolveDaemonActivity({
			daemonRunning: true,
			phase: 'backlog-sleep',
			sleepUntil: '2026-07-07T11:06:29.000Z',
			rateLimitedUntil: '2026-07-07T11:05:00.000Z',
			hasBacklog: true,
			runningWorkerJob: null,
			loopStartedAt: null,
			enrichment: enrichment({ remaining: 20, enrichedTotal: 80 }),
			nowMs: Date.parse('2026-07-07T11:01:29.000Z')
		});

		expect(activity.action).toBe('rate_limited');
		expect(activity.message).toBe('Pausing briefly (GitHub rate limit)...');
		expect(activity.nextCheckIn).toBe('2026-07-07T11:06:29.000Z');
		expect(activity.progress?.remaining).toBe(20);
	});

	it('prefers running worker job over daemon sleep phase', () => {
		const activity = resolveDaemonActivity({
			daemonRunning: true,
			phase: 'backlog-sleep',
			sleepUntil: '2026-07-07T11:06:29.000Z',
			rateLimitedUntil: null,
			hasBacklog: true,
			runningWorkerJob: {
				jobType: 'enrich',
				startedAt: '2026-07-07T11:01:29.000Z',
				detail: { planned: 48, enriched: 10, remaining: 38, current_repo: 'acme/widget' }
			},
			loopStartedAt: '2026-07-07T11:01:20.000Z',
			enrichment: enrichment({
				status: 'running',
				remaining: 40,
				enrichedTotal: 100
			})
		});

		expect(activity.action).toBe('enrich');
		expect(activity.message).toBe('Enriching acme/widget — 10 done, 38 left');
		expect(activity.startedAt).toBe('2026-07-07T11:01:29.000Z');
		expect(activity.nextCheckIn).toBeNull();
	});

	it('reports enrich backlog while sleeping between cycles', () => {
		const activity = resolveDaemonActivity({
			daemonRunning: true,
			phase: 'backlog-sleep',
			sleepUntil: '2026-07-07T11:06:29.000Z',
			rateLimitedUntil: null,
			hasBacklog: true,
			runningWorkerJob: null,
			loopStartedAt: null,
			enrichment: enrichment({ remaining: 25, enrichedTotal: 75 })
		});

		expect(activity.action).toBe('enrich');
		expect(activity.message).toContain('75 done');
		expect(activity.nextCheckIn).toBe('2026-07-07T11:06:29.000Z');
	});

	it('reports caught up when idle without backlog', () => {
		const activity = resolveDaemonActivity({
			daemonRunning: true,
			phase: 'sleeping',
			sleepUntil: '2026-07-07T11:06:29.000Z',
			rateLimitedUntil: null,
			hasBacklog: false,
			runningWorkerJob: null,
			loopStartedAt: null,
			enrichment: enrichment()
		});

		expect(activity.action).toBe('idle');
		expect(activity.message).toBe('Caught up — waiting for new activity.');
	});

	it('maps archive phase to archive message', () => {
		const activity = resolveDaemonActivity({
			daemonRunning: true,
			phase: 'archive',
			sleepUntil: null,
			rateLimitedUntil: null,
			hasBacklog: true,
			runningWorkerJob: null,
			loopStartedAt: '2026-07-07T11:01:29.000Z',
			enrichment: enrichment()
		});

		expect(activity.action).toBe('archive');
		expect(activity.message).toBe('Saving snapshots for 25 repositories...');
		expect(activity.startedAt).toBe('2026-07-07T11:01:29.000Z');
	});
});
