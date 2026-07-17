import type { RepoQuery } from './types';

function appendClusterFilters(
	opts: RepoQuery,
	alias: string,
	where: string[],
	params: (string | number)[]
): void {
	const slugs = resolveClusterSlugs(opts);
	if (slugs.length === 0) return;

	const minConfidence = opts.minClusterConfidence ?? 0;
	const matchAll = opts.clusterMatch === 'all';

	if (matchAll) {
		for (const slug of slugs) {
			where.push(
				`EXISTS (
				  SELECT 1 FROM repository_cluster_memberships m
				  JOIN repo_clusters c ON c.id = m.cluster_id
				  WHERE m.repository_id = ${alias}.id
				    AND c.slug = ?
				    AND m.confidence >= ?
				)`
			);
			params.push(slug, minConfidence);
		}
		return;
	}

	const placeholders = slugs.map(() => '?').join(', ');
	where.push(
		`EXISTS (
		  SELECT 1 FROM repository_cluster_memberships m
		  JOIN repo_clusters c ON c.id = m.cluster_id
		  WHERE m.repository_id = ${alias}.id
		    AND c.slug IN (${placeholders})
		    AND m.confidence >= ?
		)`
	);
	params.push(...slugs, minConfidence);
}

function resolveClusterSlugs(opts: RepoQuery): string[] {
	if (opts.clusters?.length) return opts.clusters;
	if (opts.cluster) return [opts.cluster];
	return [];
}

export type RepoSort =
	| 'newest_discovered'
	| 'created_at'
	| 'stars'
	| 'forks'
	| 'watchers'
	| 'updated_at'
	| 'pushed_at'
	| 'recently_archived'
	| 'recently_released'
	| 'interesting_score';

export const REPO_SORTS: RepoSort[] = [
	'newest_discovered',
	'created_at',
	'stars',
	'forks',
	'watchers',
	'updated_at',
	'pushed_at',
	'recently_archived',
	'recently_released',
	'interesting_score'
];

export function parseRepoSort(value: string | null | undefined): RepoSort {
	if (value && REPO_SORTS.includes(value as RepoSort)) return value as RepoSort;
	// legacy feed mapping
	switch (value) {
		case 'newest':
			return 'newest_discovered';
		case 'recently_archived':
		case 'recently_released':
		case 'recently_updated':
			return value === 'recently_updated' ? 'updated_at' : (value as RepoSort);
		default:
			return 'newest_discovered';
	}
}

export function buildRepoFilters(
	opts: RepoQuery,
	alias = 'repos'
): { clause: string; params: (string | number)[] } {
	const where: string[] = [];
	const params: (string | number)[] = [];

	if (opts.language) {
		where.push(`${alias}.language = ?`);
		params.push(opts.language);
	}

	if (opts.source) {
		where.push(`${alias}.discovery_source = ?`);
		params.push(opts.source);
	}

	if (opts.year) {
		where.push(`strftime('%Y', ${alias}.first_seen_at) = ?`);
		params.push(String(opts.year));
	}

	if (opts.dateFrom) {
		where.push(`${alias}.first_seen_at >= ?`);
		params.push(`${opts.dateFrom}T00:00:00.000Z`);
	}

	if (opts.dateTo) {
		where.push(`${alias}.first_seen_at <= ?`);
		params.push(`${opts.dateTo}T23:59:59.999Z`);
	}

	if (opts.neverEnriched) {
		where.push(`${alias}.enriched_at IS NULL`);
	}

	if (opts.archivedOnly) {
		where.push(`EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = ${alias}.id)`);
	}

	if (opts.hasReadme) {
		where.push(
			`EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = ${alias}.id AND a.snapshot_type = 'readme')`
		);
	}

	if (opts.hasRelease) {
		where.push(`EXISTS (SELECT 1 FROM releases rl WHERE rl.repo_id = ${alias}.id)`);
	}

	if (opts.deletedOnly) {
		where.push(`${alias}.deleted_at IS NOT NULL`);
	} else if (!opts.includeDeleted) {
		where.push(`${alias}.deleted_at IS NULL`);
	}

	const effectiveMinStars =
		opts.feed === 'new_100_stars'
			? Math.max(opts.minStars ?? 0, 100)
			: opts.minStars;

	if (effectiveMinStars != null && effectiveMinStars > 0) {
		where.push(`${alias}.stars >= ?`);
		params.push(effectiveMinStars);
	}

	if (opts.maxStars != null && opts.maxStars > 0) {
		where.push(`${alias}.stars <= ?`);
		params.push(opts.maxStars);
	}

	if (opts.minForks != null && opts.minForks > 0) {
		where.push(`${alias}.forks >= ?`);
		params.push(opts.minForks);
	}

	if (opts.category) {
		where.push(`${alias}.category = ?`);
		params.push(opts.category);
	}

	if (opts.signalTier) {
		where.push(`${alias}.signal_tier = ?`);
		params.push(opts.signalTier);
	}

	if (opts.minInterestingScore != null && opts.minInterestingScore > 0) {
		where.push(`${alias}.interesting_score >= ?`);
		params.push(opts.minInterestingScore);
	}

	appendClusterFilters(opts, alias, where, params);

	// legacy feed filters when sort not explicitly set
	const sort = resolveSort(opts);
	if (sort === 'recently_archived') {
		where.push(`EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = ${alias}.id)`);
	}
	if (sort === 'recently_released') {
		where.push(`EXISTS (SELECT 1 FROM releases rl WHERE rl.repo_id = ${alias}.id)`);
	}

	return {
		clause: where.length ? `WHERE ${where.join(' AND ')}` : '',
		params
	};
}

export function resolveSort(opts: RepoQuery): RepoSort {
	if (opts.sort) return parseRepoSort(opts.sort);
	if (opts.feed) return parseRepoSort(opts.feed);
	return 'newest_discovered';
}

export function buildRepoOrderBy(opts: RepoQuery, alias = 'repos'): string {
	const sort = resolveSort(opts);
	switch (sort) {
		case 'created_at':
			return `${alias}.created_at DESC`;
		case 'stars':
			return `${alias}.stars IS NULL, ${alias}.stars DESC`;
		case 'forks':
			return `${alias}.forks IS NULL, ${alias}.forks DESC`;
		case 'watchers':
			return `${alias}.watchers IS NULL, ${alias}.watchers DESC`;
		case 'updated_at':
			return `${alias}.updated_at IS NULL, ${alias}.updated_at DESC`;
		case 'pushed_at':
			return `${alias}.pushed_at IS NULL, ${alias}.pushed_at DESC`;
		case 'recently_archived':
			return `(SELECT MAX(a.archived_at) FROM archive_snapshots a WHERE a.repo_id = ${alias}.id) DESC`;
		case 'recently_released':
			return `(SELECT MAX(COALESCE(rl.published_at, rl.first_seen_at)) FROM releases rl WHERE rl.repo_id = ${alias}.id) DESC`;
		case 'interesting_score':
			return `${alias}.interesting_score IS NULL, ${alias}.interesting_score DESC`;
		default:
			return `${alias}.first_seen_at DESC`;
	}
}
