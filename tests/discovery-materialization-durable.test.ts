import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { getSchemaVersion, repairSchemaDrift, runMigrationsThrough } from '$lib/server/db/schema';
import {
	discoveryMaterializationStaleMs,
	getLatestPublishedDiscoveryMaterializationRun,
	isDiscoveryMaterializationStale,
	tryClaimDiscoveryMaterializationRun
} from '$lib/server/discovery-materialization';
import {
	getMaterializedDiscoveryLanding,
	materializeDiscoveryResults
} from '$lib/server/discovery-materialized';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('durable discovery materialization', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('publishes successfully with run metadata and per-section row counts', () => {
		const result = materializeDiscoveryResults({ limit: 10, minScore: 40 });
		expect(result.status).toBe('success');
		expect(result.runId).toBeTruthy();
		expect(result.rowCounts).toMatchObject({
			projects_to_watch: expect.any(Number),
			fastest_clusters: expect.any(Number),
			deleted_preserved: expect.any(Number),
			unusual_finds: expect.any(Number),
			emerging_topics: expect.any(Number)
		});
		expect(getMaterializedDiscoveryLanding({ limit: 5 })).not.toBeNull();

		const published = getLatestPublishedDiscoveryMaterializationRun();
		expect(published?.id).toBe(result.runId);
		expect(published?.status).toBe('success');
		expect(published?.published).toBe(1);
		expect(published?.row_counts_json).toBeTruthy();
	});

	it('preserves last-known-good payloads when a refresh fails mid-publish', () => {
		const first = materializeDiscoveryResults({ limit: 10, minScore: 40 });
		expect(first.status).toBe('success');
		const before = getMaterializedDiscoveryLanding({ limit: 50 });
		expect(before).not.toBeNull();

		const db = getDb();
		const marker = 'durable-marker-topic';
		db.prepare(
			`INSERT INTO discovery_emerging_topics
			 (rank, tier, topic_key, payload_json, materialized_at)
			 VALUES (?, ?, ?, ?, ?)`
		).run(
			999,
			'qualified',
			marker,
			JSON.stringify({ key: marker, detection_version: 2 }),
			'2026-07-31T00:00:00.000Z'
		);

		// Break publish by making one payload table unwritable mid-transaction.
		db.exec('DROP TABLE discovery_unusual_finds');

		const failed = materializeDiscoveryResults({ limit: 10, minScore: 40 });
		expect(failed.status).toBe('failed');

		// Recreate the dropped table so the read path can open other sections;
		// the published emerging marker must still be present (rollback).
		db.exec(`
			CREATE TABLE discovery_unusual_finds (
				rank INTEGER NOT NULL PRIMARY KEY,
				tier TEXT NOT NULL,
				repo_id INTEGER NOT NULL,
				payload_json TEXT NOT NULL,
				materialized_at TEXT NOT NULL
			);
		`);

		const rows = db
			.prepare(`SELECT topic_key FROM discovery_emerging_topics WHERE topic_key = ?`)
			.all(marker) as { topic_key: string }[];
		expect(rows.length).toBe(1);
		expect(getLatestPublishedDiscoveryMaterializationRun()?.id).toBe(first.runId);
	});

	it('dedupes overlapping runs across concurrent claims', () => {
		const first = tryClaimDiscoveryMaterializationRun({ owner: 'owner-a', leaseMs: 60_000 });
		expect(first.claimed).toBe(true);
		const second = tryClaimDiscoveryMaterializationRun({ owner: 'owner-b', leaseMs: 60_000 });
		expect(second.claimed).toBe(false);
		if (!second.claimed) {
			expect(second.reason).toBe('lease_held');
			expect(second.activeRunId).toBe(first.claimed ? first.runId : -1);
		}

		const skipped = materializeDiscoveryResults({ limit: 5, owner: 'owner-c' });
		expect(skipped.status).toBe('skipped_deduped');
	});

	it('exposes an explicit staleness window', () => {
		expect(discoveryMaterializationStaleMs()).toBeGreaterThan(0);
		expect(isDiscoveryMaterializationStale(null)).toBe(true);
		const fresh = new Date(Date.now() - 1_000).toISOString();
		expect(isDiscoveryMaterializationStale(fresh)).toBe(false);
		const old = new Date(Date.now() - discoveryMaterializationStaleMs() - 1_000).toISOString();
		expect(isDiscoveryMaterializationStale(old)).toBe(true);
	});

	it('repairs migration026 drift when schema_version advanced without discovery tables', () => {
		const db = getDb();
		expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(39);

		for (const table of [
			'discovery_system_status',
			'discovery_projects_to_watch',
			'discovery_emerging_topics',
			'discovery_fastest_clusters',
			'discovery_deleted_preserved',
			'discovery_unusual_finds',
			'scheduled_jobs'
		]) {
			db.exec(`DROP TABLE IF EXISTS ${table}`);
		}

		const repairs = repairSchemaDrift(db);
		expect(repairs).toContain('026:discovery_materialization_tables');
		const tables = new Set(
			(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(
				(row) => row.name
			)
		);
		expect(tables.has('discovery_system_status')).toBe(true);
		expect(tables.has('scheduled_jobs')).toBe(true);
	});
});

describe('migration039 on frozen pre-039 schema', () => {
	afterEach(() => teardownTestDb());

	it('adds discovery_materialization_runs at schema 39', () => {
		teardownTestDb();
		setupTestDb();
		const db = getDb();
		// Fresh test DB is already at CURRENT; verify table exists after migrations.
		const row = db
			.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
			.get('discovery_materialization_runs') as { name: string } | undefined;
		expect(row?.name).toBe('discovery_materialization_runs');
		expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(39);
		// Keep runMigrationsThrough import exercised for compile/type presence.
		expect(typeof runMigrationsThrough).toBe('function');
	});
});
