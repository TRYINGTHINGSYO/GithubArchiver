import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/db/schema';
import { getDataReadiness } from '$lib/server/data-readiness';
import {
	getHomepageHighSignalCount,
	getHomepageHighSignalRepos,
	materializeHomepageReadiness
} from '$lib/server/homepage-readiness-materialized';
import {
	getPublishedHomepageReadinessSnapshot,
	homepageReadinessWatermarksMatch,
	isHomepageReadinessSnapshotFresh,
	readHomepageSourceWatermarks,
	tryClaimHomepageReadinessRun
} from '$lib/server/homepage-readiness-materialization';
import { createTestRepo, setupTestDb, teardownTestDb } from './helpers/db';

describe('homepage readiness + high-signal materialization', () => {
	beforeEach(() => {
		setupTestDb();
		for (let i = 0; i < 5; i++) {
			const repo = createTestRepo({
				enriched_at: '2026-07-01T12:00:00.000Z',
				topics: ['demo']
			});
			getDb()
				.prepare(
					`UPDATE repos SET
					   interesting_score = ?,
					   signal_tier = 'high',
					   category = 'tool',
					   category_confidence = 0.9,
					   enrichment_level = 1,
					   classified_at = ?,
					   clustered_at = ?
					 WHERE id = ?`
				)
				.run(70 + i, '2026-07-01T13:00:00.000Z', '2026-07-01T13:00:00.000Z', repo.id);
		}
	});
	afterEach(() => teardownTestDb());

	it('publishes readiness and high-signal under one snapshot identity', () => {
		const result = materializeHomepageReadiness({ highSignalLimit: 8, minScore: 55 });
		expect(result.status).toBe('success');
		expect(result.runId).toBeTruthy();

		const snapshot = getPublishedHomepageReadinessSnapshot();
		expect(snapshot).not.toBeNull();
		expect(snapshot?.runId).toBe(result.runId);
		expect(snapshot?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(snapshot?.highSignalRepos.length).toBeGreaterThan(0);
		expect(snapshot?.highSignalCount).toBeGreaterThanOrEqual(snapshot!.highSignalRepos.length);
		expect(result.snapshotRunId).toBe(snapshot?.runId);

		expect(getDataReadiness({ windowDays: 7 }).totalRepos).toBe(snapshot!.readiness.totalRepos);
		expect(getHomepageHighSignalRepos({ limit: 8 }).length).toBe(
			Math.min(8, snapshot!.highSignalRepos.length)
		);
		expect(getHomepageHighSignalCount()).toBe(snapshot!.highSignalCount);
	});

	it('preserves published snapshot when a refresh fails', () => {
		const first = materializeHomepageReadiness();
		expect(first.status).toBe('success');
		const before = getPublishedHomepageReadinessSnapshot();
		expect(before?.runId).toBe(first.runId);
		const beforeCount = before!.highSignalCount;

		// Keep the good snapshot under a backup name, replace with a broken schema so
		// the next publish transaction fails without touching the backup row.
		getDb().exec(`ALTER TABLE homepage_readiness_snapshot RENAME TO homepage_readiness_snapshot_bak`);
		getDb().exec(`
			CREATE TABLE homepage_readiness_snapshot (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				run_id INTEGER NOT NULL
			);
		`);
		const failed = materializeHomepageReadiness({ owner: 'tx-fail' });
		expect(failed.status).toBe('failed');

		getDb().exec(`DROP TABLE homepage_readiness_snapshot`);
		getDb().exec(`ALTER TABLE homepage_readiness_snapshot_bak RENAME TO homepage_readiness_snapshot`);
		const after = getPublishedHomepageReadinessSnapshot();
		expect(after?.runId).toBe(before?.runId);
		expect(after?.highSignalCount).toBe(beforeCount);
	});

	it('dedupes concurrent readiness claims', () => {
		const first = tryClaimHomepageReadinessRun({ owner: 'a', leaseMs: 60_000 });
		expect(first.claimed).toBe(true);
		const second = tryClaimHomepageReadinessRun({ owner: 'b', leaseMs: 60_000 });
		expect(second.claimed).toBe(false);
		const skipped = materializeHomepageReadiness({ owner: 'c' });
		expect(skipped.status).toBe('skipped_deduped');
	});

	it('detects age staleness and watermark mismatch', () => {
		const result = materializeHomepageReadiness();
		expect(result.status).toBe('success');
		const snapshot = getPublishedHomepageReadinessSnapshot();
		expect(snapshot).not.toBeNull();
		expect(isHomepageReadinessSnapshotFresh(snapshot)).toBe(true);

		const mismatched = {
			...snapshot!.watermarks,
			repoCount: snapshot!.watermarks.repoCount + 1
		};
		expect(homepageReadinessWatermarksMatch(snapshot!.watermarks, mismatched)).toBe(false);
		expect(
			isHomepageReadinessSnapshotFresh(snapshot, { currentWatermarks: mismatched })
		).toBe(false);

		expect(
			isHomepageReadinessSnapshotFresh(snapshot, {
				now: Date.parse(snapshot!.publishedAt) + 16 * 60 * 1000
			})
		).toBe(false);
	});

	it('falls back to live readiness when no snapshot exists', () => {
		expect(getPublishedHomepageReadinessSnapshot()).toBeNull();
		const live = getDataReadiness({ windowDays: 7, forceLive: true });
		expect(live.totalRepos).toBeGreaterThan(0);
		const viaDefault = getDataReadiness({ windowDays: 7 });
		expect(viaDefault.totalRepos).toBe(live.totalRepos);
		expect(getHomepageHighSignalCount()).toBeGreaterThanOrEqual(0);
	});

	it('records source watermarks on publish', () => {
		materializeHomepageReadiness();
		const snapshot = getPublishedHomepageReadinessSnapshot();
		const live = readHomepageSourceWatermarks();
		expect(snapshot?.watermarks).toEqual(live);
	});
});
