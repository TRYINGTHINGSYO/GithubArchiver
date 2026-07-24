import { clusterStoryPriorityIndex } from '$lib/server/cluster-registry';
import { normalizeCategory, type RepoCategory } from '$lib/server/classify-repo';
import type { ClusterMatchEvidence } from '$lib/server/cluster-repo';
import {
	STORY_MIN_GROWTH_PREVIOUS_WEEK,
	STORY_MIN_LANGUAGE_SAMPLE,
	STORY_MIN_PERCENTILE_SAMPLE,
	STORY_SURGE_GROWTH_PERCENT,
	type ArchiveStoryClusterRef,
	type ArchiveStoryFacts,
	type ArchiveStoryLanguageContext,
	type ArchiveStoryPercentile,
	type ArchiveStoryWeeklyContext
} from '$lib/server/archive-story-types';
import { getRepoClusterMemberships } from '$lib/server/db/clusters';
import { getDb } from '$lib/server/db/connection';
import type { RepoRow } from '$lib/server/db/types';
import { computeGrowthPercent, isGrowthFromZero } from '$lib/server/growth';
import type { SignalTier } from '$lib/server/score-repo';

function weekBoundsUtc(iso: string): { weekStart: string; weekEnd: string } {
	const date = new Date(iso);
	const day = date.getUTCDay();
	const mondayOffset = day === 0 ? -6 : 1 - day;
	const start = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + mondayOffset)
	);
	const end = new Date(start);
	end.setUTCDate(end.getUTCDate() + 7);
	return { weekStart: start.toISOString(), weekEnd: end.toISOString() };
}

function previousWeekBounds(weekStartIso: string): { weekStart: string; weekEnd: string } {
	const start = new Date(weekStartIso);
	start.setUTCDate(start.getUTCDate() - 7);
	const end = new Date(weekStartIso);
	return { weekStart: start.toISOString(), weekEnd: end.toISOString() };
}

function evidenceScore(evidenceJson: string): number {
	try {
		const evidence = JSON.parse(evidenceJson) as ClusterMatchEvidence;
		const breakdown = evidence.scoreBreakdown ?? {
			topics: 0,
			name: 0,
			readme: 0,
			files: 0,
			language: 0,
			weak: 0
		};
		return (
			breakdown.topics +
			breakdown.name +
			breakdown.readme +
			breakdown.files +
			(breakdown.language ?? 0) +
			(breakdown.weak ?? 0)
		);
	} catch {
		return 0;
	}
}

export function pickPrimaryCluster(
	clusters: ArchiveStoryClusterRef[]
): ArchiveStoryClusterRef | undefined {
	if (clusters.length === 0) return undefined;
	if (clusters.length === 1) return clusters[0];

	const ranked = [...clusters].sort((a, b) => {
		if (b.confidence !== a.confidence) return b.confidence - a.confidence;
		const evidenceDelta = (b.evidenceScore ?? 0) - (a.evidenceScore ?? 0);
		if (evidenceDelta !== 0) return evidenceDelta;
		return clusterStoryPriorityIndex(a.slug) - clusterStoryPriorityIndex(b.slug);
	});

	return ranked[0];
}

function countClusterReposInWeek(
	clusterSlug: string,
	weekStart: string,
	weekEnd: string
): number {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT COUNT(DISTINCT r.id) as count
			 FROM repos r
			 JOIN repository_cluster_memberships m ON m.repository_id = r.id
			 JOIN repo_clusters c ON c.id = m.cluster_id
			 WHERE c.slug = ?
			   AND r.created_at >= ?
			   AND r.created_at < ?`
		)
		.get(clusterSlug, weekStart, weekEnd) as { count: number };
	return row.count;
}

function buildWeeklyContext(
	clusterSlug: string,
	createdAt: string
): ArchiveStoryWeeklyContext {
	const { weekStart, weekEnd } = weekBoundsUtc(createdAt);
	const previous = previousWeekBounds(weekStart);
	const repoCount = countClusterReposInWeek(clusterSlug, weekStart, weekEnd);
	const previousWeekCount = countClusterReposInWeek(
		clusterSlug,
		previous.weekStart,
		previous.weekEnd
	);

	const growthPercent = computeGrowthPercent(
		repoCount,
		previousWeekCount,
		STORY_MIN_GROWTH_PREVIOUS_WEEK
	);
	const growthFromZero = isGrowthFromZero(repoCount, previousWeekCount);
	const surge = growthPercent != null && growthPercent >= STORY_SURGE_GROWTH_PERCENT;

	return {
		weekStart,
		repoCount,
		previousWeekCount,
		growthPercent,
		growthFromZero,
		surge
	};
}

function buildPercentile(
	repo: RepoRow,
	clusterSlug: string,
	weekStart: string,
	weekEnd: string
): ArchiveStoryPercentile | undefined {
	if (repo.interesting_score == null) return undefined;

	const db = getDb();
	const signalTier = (repo.signal_tier ?? 'normal') as SignalTier;
	const rows = db
		.prepare(
			`SELECT r.interesting_score as score
			 FROM repos r
			 JOIN repository_cluster_memberships m ON m.repository_id = r.id
			 JOIN repo_clusters c ON c.id = m.cluster_id
			 WHERE c.slug = ?
			   AND r.created_at >= ?
			   AND r.created_at < ?
			   AND COALESCE(r.signal_tier, 'normal') = ?
			   AND r.interesting_score IS NOT NULL`
		)
		.all(clusterSlug, weekStart, weekEnd, signalTier) as { score: number }[];

	const sampleSize = rows.length;
	if (sampleSize < STORY_MIN_PERCENTILE_SAMPLE) return undefined;

	const below = rows.filter((row) => row.score < repo.interesting_score!).length;
	const withinCluster = Math.round((below / sampleSize) * 100);
	const topPercent = Math.max(1, 100 - withinCluster);

	return { withinCluster, sampleSize, topPercent };
}

function buildLanguageContext(
	repo: RepoRow,
	clusterSlug: string,
	weekStart: string,
	weekEnd: string
): ArchiveStoryLanguageContext | undefined {
	if (!repo.language) return undefined;

	const db = getDb();
	const row = db
		.prepare(
			`SELECT
			   COUNT(*) as total,
			   SUM(CASE WHEN r.language = ? THEN 1 ELSE 0 END) as language_count
			 FROM repos r
			 JOIN repository_cluster_memberships m ON m.repository_id = r.id
			 JOIN repo_clusters c ON c.id = m.cluster_id
			 WHERE c.slug = ?
			   AND r.created_at >= ?
			   AND r.created_at < ?
			   AND r.language IS NOT NULL
			   AND r.language != ''`
		)
		.get(repo.language, clusterSlug, weekStart, weekEnd) as {
		total: number;
		language_count: number;
	};

	if (row.total < STORY_MIN_LANGUAGE_SAMPLE || row.language_count === 0) return undefined;

	return {
		language: repo.language,
		clusterSharePercent: Math.round((row.language_count / row.total) * 1000) / 10,
		sampleSize: row.total
	};
}

function isActiveAtLastCheck(repo: RepoRow): boolean {
	if (repo.deleted_at) return false;
	const reference = repo.pushed_at ?? repo.last_checked_at ?? repo.updated_at;
	if (!reference) return false;
	const days = (Date.now() - new Date(reference).getTime()) / 86_400_000;
	return days <= 180;
}

export function buildArchiveStoryFacts(repo: RepoRow): ArchiveStoryFacts {
	const memberships = getRepoClusterMemberships(repo.id);
	const clusters: ArchiveStoryClusterRef[] = memberships.map((membership) => ({
		slug: membership.slug,
		name: membership.name,
		confidence: membership.confidence,
		evidenceScore: evidenceScore(membership.evidence_json)
	}));

	const primaryCluster = pickPrimaryCluster(clusters);
	const category = normalizeCategory(repo.category) ?? 'unknown';
	const signalTier = (repo.signal_tier ?? 'normal') as SignalTier;

	let weeklyContext: ArchiveStoryWeeklyContext | undefined;
	let percentile: ArchiveStoryPercentile | undefined;
	let languageContext: ArchiveStoryLanguageContext | undefined;

	if (primaryCluster) {
		weeklyContext = buildWeeklyContext(primaryCluster.slug, repo.created_at);
		const { weekStart, weekEnd } = weekBoundsUtc(repo.created_at);
		percentile = buildPercentile(repo, primaryCluster.slug, weekStart, weekEnd);
		languageContext = buildLanguageContext(repo, primaryCluster.slug, weekStart, weekEnd);
	}

	return {
		repoId: repo.id,
		createdAt: repo.created_at,
		category: category as RepoCategory,
		interestingScore: repo.interesting_score,
		signalTier,
		clusters,
		primaryCluster,
		weeklyContext,
		percentile,
		languageContext,
		status: {
			archived: repo.github_archived === 1,
			deleted: repo.deleted_at != null,
			activeAtLastCheck: isActiveAtLastCheck(repo)
		}
	};
}
