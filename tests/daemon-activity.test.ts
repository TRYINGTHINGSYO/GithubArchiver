import { describe, expect, it } from 'vitest';
import { formatActivityMessage, resolveDaemonActivity } from '$lib/server/daemon-activity';

describe('daemon-activity', () => {
	it('formats active enrich message with count', () => {
		expect(formatActivityMessage('enrich', 50, true)).toBe(
			'Reading READMEs and tagging 50 repositories...'
		);
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
			nowMs: Date.parse('2026-07-07T11:01:29.000Z')
		});

		expect(activity).toEqual({
			action: 'rate_limited',
			message: 'Pausing briefly (GitHub rate limit)...',
			startedAt: null,
			progress: null,
			nextCheckIn: '2026-07-07T11:06:29.000Z'
		});
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
				detail: { planned: 48 }
			},
			loopStartedAt: '2026-07-07T11:01:20.000Z'
		});

		expect(activity.action).toBe('enrich');
		expect(activity.message).toBe('Reading READMEs and tagging 48 repositories...');
		expect(activity.startedAt).toBe('2026-07-07T11:01:29.000Z');
		expect(activity.nextCheckIn).toBeNull();
	});

	it('reports idle with backlog while sleeping between cycles', () => {
		const activity = resolveDaemonActivity({
			daemonRunning: true,
			phase: 'backlog-sleep',
			sleepUntil: '2026-07-07T11:06:29.000Z',
			rateLimitedUntil: null,
			hasBacklog: true,
			runningWorkerJob: null,
			loopStartedAt: null
		});

		expect(activity.action).toBe('idle');
		expect(activity.message).toBe('Waiting for next check...');
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
			loopStartedAt: null
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
			loopStartedAt: '2026-07-07T11:01:29.000Z'
		});

		expect(activity.action).toBe('archive');
		expect(activity.message).toBe('Saving snapshots for 25 repositories...');
		expect(activity.startedAt).toBe('2026-07-07T11:01:29.000Z');
	});
});
