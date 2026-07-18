import { getStoredArchiveStory } from '$lib/server/db/archive-story';
import {
	getRepoClusterMemberships,
	listActiveClusterSummaries,
	listClusterAnalytics,
	type ClusterAnalyticsRow
} from '$lib/server/db/clusters';
import { cached } from '$lib/server/ttl-cache';
import { getDb } from '$lib/server/db/connection';
import { parseTopics } from '$lib/server/db/repos';
import type { RepoRow } from '$lib/server/db/types';
import { DISCOVERY_PRESETS, type DiscoveryPreset } from '$lib/server/discovery-presets';
import { getMaterializedDiscoveryLanding } from '$lib/server/discovery-materialized';
import { listEmergingTopics, type EmergingTopicRow } from '$lib/server/emerging-topics';

export type DiscoveryPeriod = '7d' | '14d' | '30d';

export interface DiscoveryQuery {
	period: DiscoveryPeriod;
	language?: string;
	category?: string;
	cluster?: string;
	minScore: number;
	limit: number;
	includeCoursework?: boolean;
}

export interface DiscoveryClusterCard {
	slug: string;
	name: string;
	description: string | null;
	currentWeekCount: number;
	previousWeekCount: number;
	growthPercent: number;
	avgInterestingScore: number | null;
	topLanguages: { language: string; count: number }[];
	topRepos: DiscoveryRepoCard[];
	rankingReason: string;
}

export interface DiscoveryRepoCard {
	id: number;
	owner: string;
	name: string;
	full_name: string;
	description: string | null;
	summary: string | null;
	category: string | null;
	language: string | null;
	stars: number | null;
	forks: number | null;
	interesting_score: number | null;
	signal_tier: string | null;
	deleted_at: string | null;
	github_archived: boolean;
	topics: string[];
	clusters: { slug: string; name: string; confidence: number }[];
	storyPreview: string | null;
	preservationState: string;
	hasReadme: boolean;
	hasSource: boolean;
	hasMetadata: boolean;
	rankScore: number;
	rankingReason: string;
}

export interface ProjectsToWatchItem extends DiscoveryRepoCard {
	discoveryScore: number;
	cluster: {
		slug: string;
		name: string;
		growthPercent: number;
		currentWeekCount: number;
		confidence: number;
	};
}

export interface DeletedGemItem extends DiscoveryRepoCard {
	preservationScore: number;
	recoverabilityScore: number;
	rarityScore: number;
}

export interface DiscoveryLanding {
	presets: DiscoveryPreset[];
	fastestGrowing: DiscoveryClusterCard[];
	projectsToWatch: ProjectsToWatchItem[];
	deletedGems: DeletedGemItem[];
	unusualFinds: DiscoveryRepoCard[];
	emergingTopics: EmergingTopicRow[];
	clusters: ClusterAnalyticsRow[];
}

export interface ActiveClusterCard {
	slug: string;
	name: string;
	description: string | null;
	repoCount: number;
	new7d: number;
	avgInterestingScore: number | null;
	topLanguages: { language: string; count: number }[];
	topRepos: DiscoveryRepoCard[];
	rankingReason: string;
	metricLabel: 'week-over-week growth' | 'recent activity';
}

const MIN_CLUSTER_CURRENT_COUNT = 20;
const MIN_CLUSTER_PREVIOUS_COUNT = 5;
const MIN_PROJECT_GROWTH = 25;
const DEFAULT_LIMIT = 50;

export function parseDiscoveryQuery(url: URL): DiscoveryQuery {
	const periodRaw = url.searchParams.get('period') ?? '7d';
	const period = periodRaw === '14d' || periodRaw === '30d' ? periodRaw : '7d';
	const limit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
	return {
		period,
		language: url.searchParams.get('language') || undefined,
		category: url.searchParams.get('category') || undefined,
		cluster: url.searchParams.get('cluster') || undefined,
		minScore: Number(url.searchParams.get('min_score') ?? 55),
		limit: Number.isFinite(limit) ? Math.min(Math.max(1, limit), 100) : DEFAULT_LIMIT,
		includeCoursework: url.searchParams.get('include_coursework') === '1'
	};
}

export function getDiscoveryLanding(opts: Partial<DiscoveryQuery> = {}): DiscoveryLanding {
	const query = normalizeQuery(opts);
	const materialized = getMaterializedDiscoveryLanding(query);
	if (materialized) {
		return {
			...materialized,
			presets: DISCOVERY_PRESETS
		};
	}
	return {
		presets: DISCOVERY_PRESETS,
		fastestGrowing: getFastestGrowingClusters({ ...query, limit: 6 }),
		projectsToWatch: getProjectsToWatch({ ...query, limit: 6 }),
		deletedGems: getDeletedGems({ ...query, limit: 6 }),
		unusualFinds: getUnusualFinds({ ...query, limit: 6 }),
		emergingTopics: listEmergingTopics({ limit: 6 }),
		clusters: listActiveClusterSummaries(24)
	};
}

function cachedClusterAnalytics(): ClusterAnalyticsRow[] {
	return cached('cluster-analytics', 30_000, () => listClusterAnalytics());
}

export function getFastestGrowingClusters(opts: Partial<DiscoveryQuery> = {}): DiscoveryClusterCard[] {
	const query = normalizeQuery(opts);
	const clusters = cachedClusterAnalytics()
		.filter((cluster) => cluster.growth_pct != null)
		.filter((cluster) => !query.cluster || cluster.slug === query.cluster)
		.filter((cluster) => cluster.new_7d >= MIN_CLUSTER_CURRENT_COUNT)
		.filter((cluster) => cluster.new_prev_7d >= MIN_CLUSTER_PREVIOUS_COUNT)
		.filter((cluster) => (cluster.avg_interesting_score ?? 0) >= Math.max(0, query.minScore - 20))
		.sort((a, b) => {
			const growthDelta = (b.growth_pct ?? 0) - (a.growth_pct ?? 0);
			if (growthDelta !== 0) return growthDelta;
			const scoreDelta = (b.avg_interesting_score ?? 0) - (a.avg_interesting_score ?? 0);
			if (scoreDelta !== 0) return scoreDelta;
			return b.new_7d - a.new_7d;
		})
		.slice(0, query.limit);

	return clusters.map((cluster) => ({
		slug: cluster.slug,
		name: cluster.name,
		description: cluster.description,
		currentWeekCount: cluster.new_7d,
		previousWeekCount: cluster.new_prev_7d,
		growthPercent: cluster.growth_pct ?? 0,
		avgInterestingScore: cluster.avg_interesting_score,
		topLanguages: cluster.top_languages,
		topRepos: listTopReposForCluster(cluster.slug, query),
		rankingReason: `${cluster.name} grew ${Math.round(cluster.growth_pct ?? 0)}% over the previous week, with ${cluster.new_7d.toLocaleString()} repositories in the current period.`
	}));
}

export function getProjectsToWatch(opts: Partial<DiscoveryQuery> = {}): ProjectsToWatchItem[] {
	const query = normalizeQuery(opts);
	const growingClusters = getGrowingClusterMap(query);
	if (growingClusters.size === 0) return [];

	const rows = queryProjectRows(query, [...growingClusters.keys()], false);
	const items = rows
		.map((row) => {
			const cluster = growingClusters.get(row.cluster_slug);
			if (!cluster) return null;
			const normalizedGrowth = Math.min(100, Math.max(0, cluster.growthPercent));
			const discoveryScore =
				(row.interesting_score ?? 0) * 0.6 +
				normalizedGrowth * 0.25 +
				row.cluster_confidence * 100 * 0.15;
			const card = toDiscoveryRepoCard(row, discoveryScore);
			return {
				...card,
				discoveryScore: Math.round(discoveryScore * 10) / 10,
				cluster: {
					slug: cluster.slug,
					name: cluster.name,
					growthPercent: cluster.growthPercent,
					currentWeekCount: cluster.currentWeekCount,
					confidence: row.cluster_confidence
				},
				rankingReason: `Ranked here because ${cluster.name} grew ${Math.round(cluster.growthPercent)}% this week, it has an Interesting Score of ${Math.round(row.interesting_score ?? 0)}, and it matched the cluster with ${Math.round(row.cluster_confidence * 100)}% confidence.`
			};
		})
		.filter((item): item is ProjectsToWatchItem => item != null)
		.sort((a, b) => b.discoveryScore - a.discoveryScore);

	return dedupeByRepo(items).slice(0, query.limit);
}

const PRELIMINARY_MIN_SCORE = 40;
const PRELIMINARY_MIN_STARS = 2;
const PRELIMINARY_MIN_AGE_MS = 6 * 60 * 60 * 1000;
const PRELIMINARY_MIN_SNAPSHOTS = 2;

/** Cold-start Projects to Watch with relaxed evidence requirements. */
export function getPreliminaryProjectsToWatch(opts: Partial<DiscoveryQuery> = {}): ProjectsToWatchItem[] {
	const query = normalizeQuery({ ...opts, minScore: PRELIMINARY_MIN_SCORE });
	const qualifiedIds = new Set(getProjectsToWatch(query).map((item) => item.id));
	const db = getDb();
	const minCreatedAt = new Date(Date.now() - PRELIMINARY_MIN_AGE_MS).toISOString();
	const rows = db
		.prepare(
			`SELECT r.*,
			        c.slug AS cluster_slug,
			        c.name AS cluster_name,
			        m.confidence AS cluster_confidence,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'readme') AS has_readme,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'source') AS has_source,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id) AS has_any_archive,
			        (SELECT MIN(c2.repo_count)
			           FROM repository_cluster_memberships m2
			           JOIN repo_clusters c2 ON c2.id = m2.cluster_id
			          WHERE m2.repository_id = r.id) AS rarest_cluster_count
			 FROM repos r
			 JOIN repository_cluster_memberships m ON m.repository_id = r.id
			 JOIN repo_clusters c ON c.id = m.cluster_id
			 WHERE r.deleted_at IS NULL
			   AND COALESCE(r.interesting_score, 0) >= ?
			   AND COALESCE(r.stars, 0) >= ?
			   AND r.created_at <= ?
			   AND COALESCE(r.category, 'unknown') NOT IN ('school-assignment', 'spam-template')
			   AND COALESCE(r.signal_tier, 'normal') != 'low'
			   AND (SELECT COUNT(*) FROM repo_metrics_snapshots s WHERE s.repo_id = r.id) >= ?
			 ORDER BY r.interesting_score DESC, m.confidence DESC, r.first_seen_at DESC
			 LIMIT ?`
		)
		.all(
			PRELIMINARY_MIN_SCORE,
			PRELIMINARY_MIN_STARS,
			minCreatedAt,
			PRELIMINARY_MIN_SNAPSHOTS,
			Math.max(query.limit * 4, 24)
		) as DiscoveryRepoRow[];

	const items = rows
		.filter((row) => !qualifiedIds.has(row.id))
		.map((row) => {
			const interesting = row.interesting_score ?? 0;
			const confidence = row.cluster_confidence ?? 0;
			const discoveryScore = interesting * 0.7 + confidence * 100 * 0.3;
			const card = toDiscoveryRepoCard(
				row,
				discoveryScore,
				`Preliminary watch candidate: Interesting Score ${Math.round(interesting)}, ${Math.round(confidence * 100)}% cluster confidence — still gathering momentum evidence.`
			);
			return {
				...card,
				discoveryScore: Math.round(discoveryScore * 10) / 10,
				cluster: {
					slug: row.cluster_slug ?? 'unknown',
					name: row.cluster_name ?? 'Unknown',
					growthPercent: 0,
					currentWeekCount: 0,
					confidence
				},
				rankingReason: card.rankingReason
			};
		});

	return dedupeByRepo(items).slice(0, query.limit);
}

/** Populated clusters with preliminary 24h activity when week-over-week growth is unavailable. */
export function getPreliminaryGrowingClusters(opts: Partial<DiscoveryQuery> = {}): DiscoveryClusterCard[] {
	const query = normalizeQuery(opts);
	return cachedClusterAnalytics()
		.filter((cluster) => cluster.repo_count > 0)
		.filter((cluster) => !query.cluster || cluster.slug === query.cluster)
		.sort((a, b) => b.new_24h - a.new_24h || b.repo_count - a.repo_count)
		.slice(0, query.limit)
		.map((cluster) => ({
			slug: cluster.slug,
			name: cluster.name,
			description: cluster.description,
			currentWeekCount: cluster.new_7d,
			previousWeekCount: cluster.new_prev_7d,
			growthPercent: cluster.growth_pct ?? 0,
			avgInterestingScore: cluster.avg_interesting_score,
			topLanguages: cluster.top_languages,
			topRepos: listTopReposForCluster(cluster.slug, { ...query, minScore: 40, limit: 3 }),
			rankingReason:
				cluster.new_prev_7d < MIN_CLUSTER_PREVIOUS_COUNT
					? `${cluster.name}: +${cluster.new_24h.toLocaleString()} repositories in the last 24 hours. Preliminary trend — limited week-over-week history.`
					: `${cluster.name} grew ${Math.round(cluster.growth_pct ?? 0)}% over the previous week.`
		}));
}

export function getDeletedGems(opts: Partial<DiscoveryQuery> = {}): DeletedGemItem[] {
	const query = normalizeQuery(opts);
	const rows = queryDeletedRows(query);
	const items = rows
		.map((row) => {
			const interesting = row.interesting_score ?? 0;
			const recoverabilityScore = (row.has_source ? 25 : 0) + (row.has_readme ? 18 : 0) + (row.has_any_archive ? 8 : 0);
			const popularityScore = Math.min(15, Math.round(Math.log10((row.stars ?? 0) + 1) * 8 + Math.log10((row.forks ?? 0) + 1) * 4));
			const rarityScore = clusterRarityScore(row.rarest_cluster_count);
			const descriptionScore = row.description && row.description.trim().length >= 30 ? 5 : 0;
			const preservationScore = Math.round(
				interesting * 0.45 + recoverabilityScore + popularityScore + rarityScore + descriptionScore
			);
			const card = toDiscoveryRepoCard(row, preservationScore);
			return {
				...card,
				preservationScore,
				recoverabilityScore,
				rarityScore,
				rankingReason: `Ranked here because it was deleted after reaching an Interesting Score of ${Math.round(interesting)}, with ${card.preservationState.toLowerCase()} and ${popularityScore} popularity points from stars/forks.`
			};
		})
		.filter((item) => item.preservationScore >= query.minScore)
		.sort((a, b) => b.preservationScore - a.preservationScore);

	return items.slice(0, query.limit);
}

/**
 * Recently discovered repositories that clear the low-signal floor.
 * Sorted by Interesting Score, then recency — not by star count.
 */
export function getNewHighSignalRepos(opts: Partial<DiscoveryQuery> = {}): DiscoveryRepoCard[] {
	const query = normalizeQuery(opts);
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT r.*,
			        0 as cluster_confidence,
			        NULL as cluster_slug,
			        NULL as cluster_name,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'readme') AS has_readme,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'source') AS has_source,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id) AS has_any_archive,
			        NULL as rarest_cluster_count
			 FROM repos r
			 WHERE r.deleted_at IS NULL
			   AND COALESCE(r.signal_tier, 'normal') IN ('normal', 'high')
			   AND COALESCE(r.interesting_score, 0) >= ?
			 ORDER BY r.interesting_score DESC, r.first_seen_at DESC
			 LIMIT ?`
		)
		.all(Math.max(40, query.minScore - 10), query.limit) as DiscoveryRepoRow[];

	return rows.map((row) =>
		toDiscoveryRepoCard(
			row,
			row.interesting_score ?? 0,
			`Shown because it is a normal/high-signal repository with an Interesting Score of ${Math.round(row.interesting_score ?? 0)}, sorted ahead of raw star-count feeds.`
		)
	);
}

/**
 * Active/high-quality clusters when week-over-week growth is unavailable.
 * Labels activity honestly rather than implying momentum.
 */
export function getActiveQualityClusters(opts: Partial<DiscoveryQuery> = {}): ActiveClusterCard[] {
	const query = normalizeQuery(opts);
	return cachedClusterAnalytics()
		.filter((cluster) => !query.cluster || cluster.slug === query.cluster)
		.filter((cluster) => cluster.repo_count > 0)
		.filter((cluster) => (cluster.avg_interesting_score ?? 0) >= Math.max(0, query.minScore - 25))
		.sort((a, b) => {
			const activityDelta = b.new_7d - a.new_7d;
			if (activityDelta !== 0) return activityDelta;
			const scoreDelta = (b.avg_interesting_score ?? 0) - (a.avg_interesting_score ?? 0);
			if (scoreDelta !== 0) return scoreDelta;
			return b.repo_count - a.repo_count;
		})
		.slice(0, query.limit)
		.map((cluster) => ({
			slug: cluster.slug,
			name: cluster.name,
			description: cluster.description,
			repoCount: cluster.repo_count,
			new7d: cluster.new_7d,
			avgInterestingScore: cluster.avg_interesting_score,
			topLanguages: cluster.top_languages,
			topRepos: listTopReposForCluster(cluster.slug, query),
			metricLabel: 'recent activity' as const,
			rankingReason: `${cluster.name} is shown for recent activity (${cluster.new_7d.toLocaleString()} repos in 7d) and average Interesting Score ${cluster.avg_interesting_score ?? '—'} — not because week-over-week growth cleared the momentum guardrails.`
		}));
}

export function getUnusualFinds(opts: Partial<DiscoveryQuery> = {}): DiscoveryRepoCard[] {
	const query = normalizeQuery(opts);
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT r.*,
			        0 as cluster_confidence,
			        NULL as cluster_slug,
			        NULL as cluster_name,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'readme') AS has_readme,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'source') AS has_source,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id) AS has_any_archive,
			        NULL as rarest_cluster_count
			 FROM repos r
			 WHERE r.deleted_at IS NULL
			   AND COALESCE(r.signal_tier, 'normal') != 'low'
			   AND COALESCE(r.interesting_score, 0) >= ?
			   AND (r.category = 'unknown' OR r.language IS NULL OR r.topics IS NULL OR r.topics = '[]')
			 ORDER BY r.interesting_score DESC, r.first_seen_at DESC
			 LIMIT ?`
		)
		.all(Math.max(40, query.minScore - 10), query.limit) as DiscoveryRepoRow[];

	return rows.map((row) =>
		toDiscoveryRepoCard(
			row,
			row.interesting_score ?? 0,
			`Surfaced because it has an Interesting Score of ${Math.round(row.interesting_score ?? 0)} but still lacks a clear category, language, or topic trail.`
		)
	);
}

function listTopReposForCluster(slug: string, query: DiscoveryQuery): DiscoveryRepoCard[] {
	const rows = queryProjectRows({ ...query, minScore: Math.max(45, query.minScore - 10), limit: 3 }, [slug], true);
	return rows.slice(0, 3).map((row) =>
		toDiscoveryRepoCard(
			row,
			row.interesting_score ?? 0,
			`Featured because it is one of the highest-scoring recent repositories in ${row.cluster_name ?? slug}.`
		)
	);
}

type GrowingCluster = {
	slug: string;
	name: string;
	growthPercent: number;
	currentWeekCount: number;
};

function getGrowingClusterMap(query: DiscoveryQuery): Map<string, GrowingCluster> {
	const clusters = getFastestGrowingClusters({ ...query, limit: 100 })
		.filter((cluster) => cluster.growthPercent >= MIN_PROJECT_GROWTH)
		.filter((cluster) => cluster.currentWeekCount >= MIN_CLUSTER_CURRENT_COUNT);
	return new Map(
		clusters.map((cluster) => [
			cluster.slug,
			{
				slug: cluster.slug,
				name: cluster.name,
				growthPercent: cluster.growthPercent,
				currentWeekCount: cluster.currentWeekCount
			}
		])
	);
}

interface DiscoveryRepoRow extends RepoRow {
	cluster_slug: string | null;
	cluster_name: string | null;
	cluster_confidence: number;
	has_readme: 0 | 1;
	has_source: 0 | 1;
	has_any_archive: 0 | 1;
	rarest_cluster_count: number | null;
}

function queryProjectRows(query: DiscoveryQuery, clusterSlugs: string[], allowCoursework: boolean): DiscoveryRepoRow[] {
	if (clusterSlugs.length === 0) return [];
	const db = getDb();
	const since = periodStart(query.period);
	const params: (string | number)[] = [...clusterSlugs, since, query.minScore];
	const where: string[] = [
		`c.slug IN (${clusterSlugs.map(() => '?').join(',')})`,
		`r.created_at >= ?`,
		`COALESCE(r.signal_tier, 'normal') != 'low'`,
		`COALESCE(r.interesting_score, 0) >= ?`,
		`r.deleted_at IS NULL`
	];

	if (query.language) {
		where.push('r.language = ?');
		params.push(query.language);
	}
	if (query.category) {
		where.push('r.category = ?');
		params.push(query.category);
	}
	if (!allowCoursework && !query.includeCoursework) {
		where.push(`COALESCE(r.category, 'unknown') NOT IN ('school-assignment', 'spam-template')`);
	}

	params.push(Math.max(query.limit * 4, 25));
	return db
		.prepare(
			`SELECT r.*,
			        c.slug AS cluster_slug,
			        c.name AS cluster_name,
			        m.confidence AS cluster_confidence,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'readme') AS has_readme,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'source') AS has_source,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id) AS has_any_archive,
			        (SELECT MIN(c2.repo_count)
			           FROM repository_cluster_memberships m2
			           JOIN repo_clusters c2 ON c2.id = m2.cluster_id
			          WHERE m2.repository_id = r.id) AS rarest_cluster_count
			 FROM repos r
			 JOIN repository_cluster_memberships m ON m.repository_id = r.id
			 JOIN repo_clusters c ON c.id = m.cluster_id
			 WHERE ${where.join(' AND ')}
			 ORDER BY r.interesting_score DESC, m.confidence DESC, r.first_seen_at DESC
			 LIMIT ?`
		)
		.all(...params) as DiscoveryRepoRow[];
}

function queryDeletedRows(query: DiscoveryQuery): DiscoveryRepoRow[] {
	const db = getDb();
	const params: (string | number)[] = [query.minScore];
	const where = [
		`r.deleted_at IS NOT NULL`,
		`COALESCE(r.interesting_score, 0) >= ?`,
		`(r.description IS NOT NULL OR r.stars > 0 OR EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id))`
	];

	if (query.language) {
		where.push('r.language = ?');
		params.push(query.language);
	}
	if (query.category) {
		where.push('r.category = ?');
		params.push(query.category);
	}
	if (query.cluster) {
		where.push(`EXISTS (
			SELECT 1 FROM repository_cluster_memberships mx
			JOIN repo_clusters cx ON cx.id = mx.cluster_id
			WHERE mx.repository_id = r.id AND cx.slug = ?
		)`);
		params.push(query.cluster);
	}

	params.push(Math.max(query.limit * 3, 25));
	return db
		.prepare(
			`SELECT r.*,
			        NULL AS cluster_slug,
			        NULL AS cluster_name,
			        0 AS cluster_confidence,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'readme') AS has_readme,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'source') AS has_source,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id) AS has_any_archive,
			        (SELECT MIN(c.repo_count)
			           FROM repository_cluster_memberships m
			           JOIN repo_clusters c ON c.id = m.cluster_id
			          WHERE m.repository_id = r.id) AS rarest_cluster_count
			 FROM repos r
			 WHERE ${where.join(' AND ')}
			 ORDER BY r.interesting_score DESC, r.stars DESC, r.forks DESC
			 LIMIT ?`
		)
		.all(...params) as DiscoveryRepoRow[];
}

function toDiscoveryRepoCard(row: DiscoveryRepoRow, rankScore: number, reason?: string): DiscoveryRepoCard {
	const clusters = getRepoClusterMemberships(row.id)
		.slice(0, 4)
		.map((membership) => ({
			slug: membership.slug,
			name: membership.name,
			confidence: membership.confidence
		}));
	// Never generate stories on GET — workers own that. Read stored text only.
	const storedStory = getStoredArchiveStory(row.id);
	const preservationState = getPreservationState(row);
	return {
		id: row.id,
		owner: row.owner,
		name: row.name,
		full_name: row.full_name,
		description: row.description,
		summary: row.summary,
		category: row.category,
		language: row.language,
		stars: row.stars,
		forks: row.forks,
		interesting_score: row.interesting_score,
		signal_tier: row.signal_tier,
		deleted_at: row.deleted_at,
		github_archived: row.github_archived === 1,
		topics: parseTopics(row.topics),
		clusters,
		storyPreview: storedStory?.story_text ?? row.story_text ?? null,
		preservationState,
		hasReadme: row.has_readme === 1,
		hasSource: row.has_source === 1,
		hasMetadata: Boolean(row.description || row.language || row.topics),
		rankScore: Math.round(rankScore * 10) / 10,
		rankingReason: reason ?? `Ranked here with score ${Math.round(rankScore)}.`
	};
}

function getPreservationState(row: DiscoveryRepoRow): string {
	if (row.has_source) return 'Source preserved';
	if (row.has_readme) return 'README preserved';
	if (row.has_any_archive) return 'Partially recoverable';
	if (row.description || row.language || row.stars != null) return 'Metadata only';
	return 'Not recoverable';
}

function clusterRarityScore(count: number | null): number {
	if (count == null) return 0;
	if (count < 20) return 10;
	if (count < 100) return 7;
	if (count < 500) return 4;
	return 1;
}

function periodStart(period: DiscoveryPeriod): string {
	const days = period === '30d' ? 30 : period === '14d' ? 14 : 7;
	return new Date(Date.now() - days * 86_400_000).toISOString();
}

function normalizeQuery(opts: Partial<DiscoveryQuery>): DiscoveryQuery {
	return {
		period: opts.period ?? '7d',
		language: opts.language,
		category: opts.category,
		cluster: opts.cluster,
		minScore: opts.minScore ?? 55,
		limit: opts.limit ?? DEFAULT_LIMIT,
		includeCoursework: opts.includeCoursework ?? false
	};
}

function dedupeByRepo<T extends DiscoveryRepoCard>(items: T[]): T[] {
	const seen = new Set<number>();
	const out: T[] = [];
	for (const item of items) {
		if (seen.has(item.id)) continue;
		seen.add(item.id);
		out.push(item);
	}
	return out;
}
