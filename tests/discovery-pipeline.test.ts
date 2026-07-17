import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ensureScheduledJobs,
	getScheduledJob,
	isJobDue,
	markJobCompleted,
	markJobFailed,
	markJobStarted
} from '$lib/server/db/scheduled-jobs';
import {
	materializeDiscoveryResults,
	getDiscoverySystemStatus,
	getMaterializedDiscoveryLanding
} from '$lib/server/discovery-materialized';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('scheduled jobs and discovery materialization', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('tracks due jobs across restart-safe timestamps', () => {
		ensureScheduledJobs(['ingest', 'discovery']);
		expect(isJobDue('ingest')).toBe(true);
		markJobStarted('ingest');
		markJobCompleted('ingest', 60_000);
		const row = getScheduledJob('ingest');
		expect(row?.status).toBe('success');
		expect(row?.next_run_at).toBeTruthy();
		expect(isJobDue('ingest', Date.now() - 1_000)).toBe(false);

		markJobFailed('discovery', 'boom', 60_000);
		const failed = getScheduledJob('discovery');
		expect(failed?.status).toBe('failed');
		expect(failed?.consecutive_failures).toBe(1);
		expect(failed?.last_error).toBe('boom');
	});

	it('materializes discovery tables and status snapshot', () => {
		const result = materializeDiscoveryResults({ limit: 10, minScore: 40 });
		expect(result.qualified).toBeGreaterThanOrEqual(0);
		expect(getMaterializedDiscoveryLanding({ limit: 5 })).not.toBeNull();
		const status = getDiscoverySystemStatus();
		expect(status.repositoriesDiscovered).toBeGreaterThanOrEqual(0);
		expect(status.lastDiscoveryAnalysisAt).toBeTruthy();
	});
});
