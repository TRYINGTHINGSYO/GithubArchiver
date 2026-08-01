import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '$lib/server/db/connection';
import {
	countClusterMemberships,
	countPopulatedClusters,
	ensureClusterRegistry,
	listClusters,
	saveRepoClusterMemberships
} from '$lib/server/db/clusters';
import {
	ALLOW_DEV_CLUSTER_PLACEHOLDERS,
	getActiveQualityClusters,
	getClusterSurfaceState,
	getDiscoveryLanding,
	getFastestGrowingClusters,
	getPreliminaryGrowingClusters
} from '$lib/server/discovery';
import {
	getMaterializedDiscoveryLanding,
	materializeDiscoveryResults
} from '$lib/server/discovery-materialized';
import { clearTtlCache, cached } from '$lib/server/ttl-cache';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestRepo, setupTestDb, teardownTestDb } from './helpers/db';

function seedGrowingCluster(): string {
	ensureClusterRegistry();
	const slug = listClusters()[0]?.slug;
	if (!slug) throw new Error('expected seeded cluster definitions');
	const now = Date.now();
	const day = 86_400_000;
	for (let i = 0; i < 25; i++) {
		const repo = createTestRepo({ enriched_at: new Date().toISOString() });
		getDb()
			.prepare(
				`UPDATE repos SET first_seen_at = ?, interesting_score = 70, category = 'ai-project',
				 category_confidence = 0.9, signal_tier = 'high' WHERE id = ?`
			)
			.run(new Date(now - 2 * day).toISOString(), repo.id);
		saveRepoClusterMemberships(repo.id, [
			{ slug, confidence: 0.9, evidence: { matched: ['test'] } as never }
		]);
	}
	for (let i = 0; i < 10; i++) {
		const repo = createTestRepo({ enriched_at: new Date().toISOString() });
		getDb()
			.prepare(
				`UPDATE repos SET first_seen_at = ?, interesting_score = 70, category = 'ai-project',
				 category_confidence = 0.9, signal_tier = 'high' WHERE id = ?`
			)
			.run(new Date(now - 10 * day).toISOString(), repo.id);
		saveRepoClusterMemberships(repo.id, [
			{ slug, confidence: 0.9, evidence: { matched: ['test'] } as never }
		]);
	}
	return slug;
}

describe('cluster wipe empty state', () => {
	beforeEach(() => {
		setupTestDb();
		clearTtlCache();
	});
	afterEach(() => teardownTestDb());

	it('does not render growth cards from registry seed alone on a fresh database', () => {
		ensureClusterRegistry();
		expect(listClusters().length).toBeGreaterThan(0);
		expect(countClusterMemberships()).toBe(0);
		expect(countPopulatedClusters()).toBe(0);
		expect(getFastestGrowingClusters({ limit: 12 })).toEqual([]);
		expect(getPreliminaryGrowingClusters({ limit: 12 })).toEqual([]);
		expect(getActiveQualityClusters({ limit: 12 })).toEqual([]);
		const surface = getClusterSurfaceState(false);
		expect(surface.emptyReason).toBe('no-repositories');
		expect(ALLOW_DEV_CLUSTER_PLACEHOLDERS).toBe(false);
	});

	it('explains clustering-incomplete when repos exist without memberships', () => {
		createTestRepo({ enriched_at: new Date().toISOString() });
		ensureClusterRegistry();
		const surface = getClusterSurfaceState(false);
		expect(surface.repoCount).toBe(1);
		expect(surface.membershipCount).toBe(0);
		expect(surface.emptyReason).toBe('clustering-incomplete');
		expect(getFastestGrowingClusters()).toEqual([]);
	});

	it('refuses stale materialized cluster cards after memberships are wiped', () => {
		seedGrowingCluster();
		expect(getFastestGrowingClusters({ limit: 12 }).length).toBe(1);
		materializeDiscoveryResults({ limit: 12, skipClaim: true });
		expect(getMaterializedDiscoveryLanding({ limit: 12 })?.fastestGrowing.length).toBe(1);

		getDb().exec('DELETE FROM repository_cluster_memberships; DELETE FROM repos;');
		getDb().prepare('UPDATE repo_clusters SET repo_count = 0').run();
		clearTtlCache();

		expect(getFastestGrowingClusters({ limit: 12 })).toEqual([]);
		const landing = getDiscoveryLanding({ limit: 12 });
		expect(landing.fastestGrowing).toEqual([]);
		expect(landing.clusters).toEqual([]);
		expect(landing.projectsToWatch).toEqual([]);
		expect(getMaterializedDiscoveryLanding({ limit: 12 })?.fastestGrowing).toEqual([]);

		const leftover = getDb()
			.prepare('SELECT COUNT(*) AS c FROM discovery_fastest_clusters')
			.get() as { c: number };
		expect(leftover.c).toBe(0);
	});

	it('invalidates process TTL cache when the database handle is reopened', () => {
		seedGrowingCluster();
		expect(getFastestGrowingClusters({ limit: 12 }).length).toBe(1);
		cached('probe', 60_000, () => 'stale');

		const oldPath = process.env.DATABASE_PATH!;
		closeDb();
		const newDir = mkdtempSync(join(tmpdir(), 'githubarchive-wipe-'));
		process.env.DATABASE_PATH = join(newDir, 'fresh.db');
		getDb();
		ensureClusterRegistry();

		expect(getFastestGrowingClusters({ limit: 12 })).toEqual([]);
		expect(cached('probe', 60_000, () => 'fresh')).toBe('fresh');

		closeDb();
		rmSync(newDir, { recursive: true, force: true });
		process.env.DATABASE_PATH = oldPath;
	});
});
