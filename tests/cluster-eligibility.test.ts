import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	computeClusterIntelligenceGeneration,
	hasPublicClusterIntelligenceEvidence,
	isPublicClusterEligible,
	MIN_CLUSTER_CURRENT_COUNT,
	MIN_CLUSTER_PREVIOUS_COUNT,
	MIN_PUBLIC_CLUSTER_MEMBERSHIPS,
	readStoredClusterIntelligenceMeta
} from '$lib/server/cluster-eligibility';
import {
	countClusterMemberships,
	ensureClusterRegistry,
	listClusters,
	saveRepoClusterMemberships
} from '$lib/server/db/clusters';
import { getDb } from '$lib/server/db/connection';
import {
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
import { clearTtlCache } from '$lib/server/ttl-cache';
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

describe('isPublicClusterEligible', () => {
	it('rejects taxonomy-only / zero-membership evidence', () => {
		expect(
			hasPublicClusterIntelligenceEvidence({
				membershipCount: 0,
				activeRepositoryCount: 0
			})
		).toBe(false);
		expect(
			isPublicClusterEligible({
				membershipCount: 0,
				activeRepositoryCount: 100,
				surface: 'browse'
			})
		).toBe(false);
	});

	it('enforces growth window thresholds', () => {
		expect(
			isPublicClusterEligible({
				membershipCount: 40,
				activeRepositoryCount: 100,
				growthEvidenceCount: MIN_CLUSTER_CURRENT_COUNT - 1,
				previousGrowthEvidenceCount: MIN_CLUSTER_PREVIOUS_COUNT,
				surface: 'growth'
			})
		).toBe(false);
		expect(
			isPublicClusterEligible({
				membershipCount: 40,
				activeRepositoryCount: 100,
				growthEvidenceCount: MIN_CLUSTER_CURRENT_COUNT,
				previousGrowthEvidenceCount: MIN_CLUSTER_PREVIOUS_COUNT,
				surface: 'growth'
			})
		).toBe(true);
	});

	it('rejects generation mismatches', () => {
		expect(
			isPublicClusterEligible({
				membershipCount: MIN_PUBLIC_CLUSTER_MEMBERSHIPS,
				activeRepositoryCount: 10,
				recentActivityCount: 1,
				generationId: 'old',
				expectedGenerationId: 'new',
				surface: 'preliminary'
			})
		).toBe(false);
	});
});

describe('cluster intelligence reset and repopulation', () => {
	beforeEach(() => {
		setupTestDb();
		clearTtlCache();
	});
	afterEach(() => teardownTestDb());

	it('keeps taxonomy while public surfaces stay empty on a fresh install + materialize', () => {
		ensureClusterRegistry();
		expect(listClusters().length).toBeGreaterThan(0);
		materializeDiscoveryResults({ limit: 12, skipClaim: true });

		expect(countClusterMemberships()).toBe(0);
		expect(getFastestGrowingClusters()).toEqual([]);
		expect(getPreliminaryGrowingClusters()).toEqual([]);
		expect(getActiveQualityClusters()).toEqual([]);
		expect(getDiscoveryLanding({ limit: 12 }).fastestGrowing).toEqual([]);
		expect(getMaterializedDiscoveryLanding({ limit: 12 })?.fastestGrowing).toEqual([]);
		expect(getClusterSurfaceState(false).emptyReason).toBe('no-repositories');

		const meta = readStoredClusterIntelligenceMeta();
		expect(meta?.membershipCount).toBe(0);
		expect(meta?.generationId).toBe(computeClusterIntelligenceGeneration().generationId);
	});

	it('does not create cards from repositories alone', () => {
		ensureClusterRegistry();
		createTestRepo({ enriched_at: new Date().toISOString() });
		materializeDiscoveryResults({ limit: 12, skipClaim: true });

		expect(getDiscoveryLanding({ limit: 12 }).fastestGrowing).toEqual([]);
		expect(getClusterSurfaceState(false).emptyReason).toBe('clustering-incomplete');
	});

	it('transitions empty → populated → empty across membership + materialize cycles', () => {
		expect(getDiscoveryLanding({ limit: 12 }).fastestGrowing).toEqual([]);

		const slug = seedGrowingCluster();
		clearTtlCache();
		expect(getFastestGrowingClusters({ limit: 12 }).map((c) => c.slug)).toEqual([slug]);

		materializeDiscoveryResults({ limit: 12, skipClaim: true });
		expect(getMaterializedDiscoveryLanding({ limit: 12 })?.fastestGrowing.length).toBe(1);
		expect(getDiscoveryLanding({ limit: 12 }).fastestGrowing.length).toBe(1);

		getDb().exec('DELETE FROM repository_cluster_memberships;');
		getDb().prepare('UPDATE repo_clusters SET repo_count = 0').run();
		clearTtlCache();
		materializeDiscoveryResults({ limit: 12, skipClaim: true });

		expect(getFastestGrowingClusters({ limit: 12 })).toEqual([]);
		expect(getDiscoveryLanding({ limit: 12 }).fastestGrowing).toEqual([]);
		expect(getMaterializedDiscoveryLanding({ limit: 12 })?.fastestGrowing).toEqual([]);
		const leftover = getDb()
			.prepare('SELECT COUNT(*) AS c FROM discovery_fastest_clusters')
			.get() as { c: number };
		expect(leftover.c).toBe(0);
		expect(getClusterSurfaceState(false).emptyReason).not.toBeNull();
	});

	it('rejects stale materialized cards when membership generation changes', () => {
		seedGrowingCluster();
		materializeDiscoveryResults({ limit: 12, skipClaim: true });
		expect(getMaterializedDiscoveryLanding({ limit: 12 })?.fastestGrowing.length).toBe(1);

		// Partial wipe: remove memberships but leave stale payloads + old meta generation.
		getDb().exec('DELETE FROM repository_cluster_memberships;');
		getDb().prepare('UPDATE repo_clusters SET repo_count = 0').run();
		clearTtlCache();

		expect(getMaterializedDiscoveryLanding({ limit: 12 })?.fastestGrowing).toEqual([]);
		expect(
			(getDb().prepare('SELECT COUNT(*) AS c FROM discovery_fastest_clusters').get() as { c: number })
				.c
		).toBe(0);
	});
});
