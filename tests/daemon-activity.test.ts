import { describe, expect, it } from 'vitest';
import { formatActivityMessage, resolveDaemonActivity } from '$lib/server/daemon-activity';
import type { EnrichmentProgress } from '$lib/server/enrichment-progress';
import { formatEnrichmentCounts } from '$lib/status-display';

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
	it('keeps enrich message short; counts are separate', () => {
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
		).toBe('Enriching acme/widget');
		expect(
			formatEnrichmentCounts({
				enrichedTotal: 3_290,
				completed: 13,
				remaining: 670_976
			})
		).toBe('3,290 enriched · 13 this run · 670,976 waiting');
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
		expect(activity.message).toBe('Enriching acme/widget');
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
		expect(activity.message).toBe('Building repository intelligence...');
		expect(activity.nextCheckIn).toBe('2026-07-07T11:06:29.000Z');
	});

	it('does not claim GitHub Search when enrichment backlog counts are shown', () => {
		const activity = resolveDaemonActivity({
			daemonRunning: true,
			phase: 'ingest',
			sleepUntil: null,
			rateLimitedUntil: null,
			hasBacklog: true,
			runningWorkerJob: {
				jobType: 'ingest',
				startedAt: '2026-07-07T11:01:29.000Z',
				detail: { hours_planned: 2 }
			},
			loopStartedAt: '2026-07-07T11:01:20.000Z',
			enrichment: enrichment({
				remaining: 670_976,
				enrichedTotal: 3_290,
				currentRepo: 'egnaro9/eval-history',
				completed: 13
			})
		});

		expect(activity.action).toBe('enrich');
		expect(activity.message).toBe('Enriching egnaro9/eval-history');
		expect(activity.message).not.toMatch(/Scanning GitHub/i);
		expect(activity.message).not.toMatch(/Search/i);
		expect(activity.progress?.enrichedTotal).toBe(3_290);
		expect(activity.progress?.completed).toBe(13);
		expect(activity.progress?.remaining).toBe(670_976);
	});

	it('uses archive discovery copy for ingest when enrichment backlog is empty', () => {
		expect(formatActivityMessage('ingest', 2, true, enrichment())).toBe(
			'Discovering repositories from the archive...'
		);
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
