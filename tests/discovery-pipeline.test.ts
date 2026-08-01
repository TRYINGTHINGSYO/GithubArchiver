import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ensureScheduledJobs,
	getScheduledJob,
	isJobDue,
	markJobCompleted,
	markJobFailed,
	markJobStarted
} from '$lib/server/db/scheduled-jobs';
import { getDb } from '$lib/server/db/connection';
import {
	materializeDiscoveryResults,
	getDiscoverySystemStatus,
	getMaterializedDiscoveryLanding
} from '$lib/server/discovery-materialized';
import { CURRENT_EMERGING_DETECTION_VERSION } from '$lib/server/emerging-topics';
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

	it('filters stale emerging-topic payloads from the materialized landing cache', () => {
		materializeDiscoveryResults({ limit: 10, minScore: 40 });
		const db = getDb();
		// Landing suppresses intelligence when the corpus is empty (post-wipe).
		db.prepare(
			`INSERT INTO repos (owner, name, full_name, github_url, event_id, created_at, first_seen_at, discovery_source)
			 VALUES ('acme', 'widget', 'acme/widget', 'https://github.com/acme/widget', 'e1',
			         '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 'github_search')`
		).run();
		db.prepare(
			`INSERT INTO discovery_emerging_topics
			 (rank, tier, topic_key, payload_json, materialized_at)
			 VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`
		).run(
			100,
			'qualified',
			'stale-v1-topic',
			JSON.stringify({ key: 'stale-v1-topic', detection_version: 1 }),
			'2026-07-31T00:00:00.000Z',
			101,
			'qualified',
			'current-v2-topic',
			JSON.stringify({ key: 'current-v2-topic', detection_version: CURRENT_EMERGING_DETECTION_VERSION }),
			'2026-07-31T00:00:00.000Z'
		);

		const landing = getMaterializedDiscoveryLanding({ limit: 200 });
		const keys = (landing?.emergingTopics as Array<{ key: string }> | undefined)?.map((topic) => topic.key);
		expect(keys).toContain('current-v2-topic');
		expect(keys).not.toContain('stale-v1-topic');
	});
});
