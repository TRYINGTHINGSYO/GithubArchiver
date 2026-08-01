/**
 * Public cluster intelligence eligibility.
 *
 * Taxonomy definitions (`CLUSTER_DEFINITIONS` / `repo_clusters` seed rows) may
 * exist on an empty database. They are NOT public intelligence. Only surfaces
 * that pass these predicates may emit growth/activity/browse cluster cards.
 */

import {
	countClusterMemberships,
	countPopulatedClusters
} from '$lib/server/db/clusters';
import { getDb } from '$lib/server/db/connection';
import { countRepos } from '$lib/server/db/repos';

export type PublicClusterSurface = 'growth' | 'preliminary' | 'activity' | 'browse';

/** Growth surface: current-week membership births. */
export const MIN_CLUSTER_CURRENT_COUNT = 20;
/** Growth surface: previous-week membership births. */
export const MIN_CLUSTER_PREVIOUS_COUNT = 5;

export interface PublicClusterEligibilityInput {
	/** Live membership rows for this cluster (active repos). */
	membershipCount: number;
	/** Global active (non-deleted) repository count. */
	activeRepositoryCount: number;
	/** Optional average / membership confidence in 0..1 or score space. */
	confidence?: number | null;
	/** Growth-window evidence (e.g. new_7d). */
	growthEvidenceCount?: number | null;
	/** Prior growth-window evidence (e.g. new_prev_7d). */
	previousGrowthEvidenceCount?: number | null;
	/** 24h activity evidence for preliminary surfaces. */
	recentActivityCount?: number | null;
	/** When the materialized row was published. */
	materializedAt?: string | null;
	/** Generation stamped into the materialization. */
	generationId?: string | null;
	/** Live generation of the active database. */
	expectedGenerationId?: string | null;
	/** Which public surface is requesting the card. */
	surface: PublicClusterSurface;
	/** Minimum confidence required for this surface (0..1). */
	minConfidence?: number;
}

export interface ClusterIntelligenceGeneration {
	generationId: string;
	membershipCount: number;
	activeRepositoryCount: number;
	populatedClusterCount: number;
	latestMembershipAt: string | null;
}

const META_TABLE = 'cluster_intelligence_meta';

/** Minimum memberships for preliminary / activity / browse cards. */
export const MIN_PUBLIC_CLUSTER_MEMBERSHIPS = 1;
/** Preliminary cards also need recent activity evidence. */
export const MIN_PRELIMINARY_ACTIVITY_24H = 1;

export function ensureClusterIntelligenceMetaTable(database = getDb()): void {
	database.exec(`
		CREATE TABLE IF NOT EXISTS cluster_intelligence_meta (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			generation_id TEXT NOT NULL,
			materialized_at TEXT NOT NULL,
			membership_count INTEGER NOT NULL DEFAULT 0,
			active_repository_count INTEGER NOT NULL DEFAULT 0,
			populated_cluster_count INTEGER NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL
		);
	`);
}

/**
 * Fingerprint of live membership evidence. Changes when the active database's
 * cluster intelligence inputs change (wipe, membership churn, etc.).
 */
export function computeClusterIntelligenceGeneration(
	database = getDb()
): ClusterIntelligenceGeneration {
	const membershipCount = countClusterMemberships();
	const activeRepositoryCount = countRepos();
	const populatedClusterCount = countPopulatedClusters();
	const latest = database
		.prepare(
			`SELECT MAX(clustered_at) AS latest FROM repository_cluster_memberships`
		)
		.get() as { latest: string | null } | undefined;
	const latestMembershipAt = latest?.latest ?? null;
	const generationId = [
		`m=${membershipCount}`,
		`r=${activeRepositoryCount}`,
		`p=${populatedClusterCount}`,
		`t=${latestMembershipAt ?? 'none'}`
	].join('|');
	return {
		generationId,
		membershipCount,
		activeRepositoryCount,
		populatedClusterCount,
		latestMembershipAt
	};
}

/** Global gate: may any public cluster intelligence be shown? */
export function hasPublicClusterIntelligenceEvidence(
	input: Pick<
		PublicClusterEligibilityInput,
		| 'membershipCount'
		| 'activeRepositoryCount'
		| 'generationId'
		| 'expectedGenerationId'
		| 'materializedAt'
	>
): boolean {
	if (input.activeRepositoryCount <= 0) return false;
	if (input.membershipCount < MIN_PUBLIC_CLUSTER_MEMBERSHIPS) return false;
	if (
		input.expectedGenerationId != null &&
		input.generationId != null &&
		input.generationId !== input.expectedGenerationId
	) {
		return false;
	}
	if (input.materializedAt != null) {
		const ts = Date.parse(input.materializedAt);
		if (!Number.isFinite(ts)) return false;
	}
	return true;
}

/**
 * Shared eligibility predicate for public cluster intelligence cards.
 * Taxonomy/registry presence is intentionally ignored.
 */
export function isPublicClusterEligible(input: PublicClusterEligibilityInput): boolean {
	if (
		!hasPublicClusterIntelligenceEvidence({
			membershipCount: input.membershipCount,
			activeRepositoryCount: input.activeRepositoryCount,
			generationId: input.generationId,
			expectedGenerationId: input.expectedGenerationId,
			materializedAt: input.materializedAt
		})
	) {
		return false;
	}

	const minConfidence = input.minConfidence;
	if (minConfidence != null && (input.confidence ?? 0) < minConfidence) {
		return false;
	}

	switch (input.surface) {
		case 'growth':
			return (
				(input.growthEvidenceCount ?? 0) >= MIN_CLUSTER_CURRENT_COUNT &&
				(input.previousGrowthEvidenceCount ?? 0) >= MIN_CLUSTER_PREVIOUS_COUNT
			);
		case 'preliminary':
			return (
				input.membershipCount >= MIN_PUBLIC_CLUSTER_MEMBERSHIPS &&
				(input.recentActivityCount ?? 0) >= MIN_PRELIMINARY_ACTIVITY_24H
			);
		case 'activity':
		case 'browse':
			return input.membershipCount >= MIN_PUBLIC_CLUSTER_MEMBERSHIPS;
		default:
			return false;
	}
}

export function readStoredClusterIntelligenceMeta(database = getDb()): {
	generationId: string;
	materializedAt: string;
	membershipCount: number;
	activeRepositoryCount: number;
	populatedClusterCount: number;
} | null {
	ensureClusterIntelligenceMetaTable(database);
	const row = database
		.prepare(
			`SELECT generation_id, materialized_at, membership_count, active_repository_count,
			        populated_cluster_count
			 FROM ${META_TABLE} WHERE id = 1`
		)
		.get() as
		| {
				generation_id: string;
				materialized_at: string;
				membership_count: number;
				active_repository_count: number;
				populated_cluster_count: number;
		  }
		| undefined;
	if (!row) return null;
	return {
		generationId: row.generation_id,
		materializedAt: row.materialized_at,
		membershipCount: row.membership_count,
		activeRepositoryCount: row.active_repository_count,
		populatedClusterCount: row.populated_cluster_count
	};
}

export function writeClusterIntelligenceMeta(
	input: {
		generationId: string;
		materializedAt: string;
		membershipCount: number;
		activeRepositoryCount: number;
		populatedClusterCount: number;
	},
	database = getDb()
): void {
	ensureClusterIntelligenceMetaTable(database);
	const now = new Date().toISOString();
	database
		.prepare(
			`INSERT INTO ${META_TABLE}
			 (id, generation_id, materialized_at, membership_count, active_repository_count,
			  populated_cluster_count, updated_at)
			 VALUES (1, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   generation_id = excluded.generation_id,
			   materialized_at = excluded.materialized_at,
			   membership_count = excluded.membership_count,
			   active_repository_count = excluded.active_repository_count,
			   populated_cluster_count = excluded.populated_cluster_count,
			   updated_at = excluded.updated_at`
		)
		.run(
			input.generationId,
			input.materializedAt,
			input.membershipCount,
			input.activeRepositoryCount,
			input.populatedClusterCount,
			now
		);
}

export function clearClusterIntelligenceMeta(database = getDb()): void {
	ensureClusterIntelligenceMetaTable(database);
	database.prepare(`DELETE FROM ${META_TABLE}`).run();
}
