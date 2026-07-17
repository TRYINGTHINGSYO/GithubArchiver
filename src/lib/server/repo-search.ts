import type { RepoQuery } from '$lib/server/db/types';
import { parseRepoSort } from '$lib/server/db/repo-query';

export const REPO_PAGE_SIZES = [10, 25, 50, 75, 100] as const;
export type RepoPageSize = (typeof REPO_PAGE_SIZES)[number];

export function parseRepoPageSize(value: string | number | null | undefined): RepoPageSize {
	const parsed = Number(value ?? 50);
	return REPO_PAGE_SIZES.includes(parsed as RepoPageSize) ? (parsed as RepoPageSize) : 50;
}

export function parseRepoQueryParams(url: URL): RepoQuery {
	const q = url.searchParams.get('q') ?? undefined;
	const language = url.searchParams.get('language') || undefined;
	const source = url.searchParams.get('source');
	const feed = url.searchParams.get('feed') ?? undefined;
	const sort = url.searchParams.get('sort') ?? undefined;
	const yearRaw = url.searchParams.get('year');
	const dateFrom = url.searchParams.get('date_from') || undefined;
	const dateTo = url.searchParams.get('date_to') || undefined;
	const minStarsRaw = url.searchParams.get('min_stars');
	const maxStarsRaw = url.searchParams.get('max_stars');
	const minForksRaw = url.searchParams.get('min_forks');
	const category = url.searchParams.get('category') || undefined;
	const signalTier = url.searchParams.get('signal_tier') || undefined;
	const minInterestingRaw = url.searchParams.get('min_interesting_score');
	const cluster = url.searchParams.get('cluster') || undefined;
	const clustersRaw = url.searchParams.get('clusters');
	const clusterMatchRaw = url.searchParams.get('cluster_match');
	const minClusterConfidenceRaw = url.searchParams.get('min_cluster_confidence');

	const deletedOnly =
		url.searchParams.get('deleted_only') === '1' || feed === 'recently_deleted';
	const feedMinStars = feed === 'new_100_stars' ? 100 : undefined;

	const allowedSources = new Set(['gharchive', 'github_search', 'trending', 'manual']);

	const clusters = clustersRaw
		? clustersRaw
				.split(',')
				.map((slug) => slug.trim())
				.filter(Boolean)
		: cluster
			? [cluster]
			: undefined;

	const clusterMatch =
		clusterMatchRaw === 'all' ? ('all' as const) : clusterMatchRaw === 'any' ? ('any' as const) : undefined;

	return {
		q,
		language,
		source: source && allowedSources.has(source) ? source : undefined,
		feed,
		sort: sort ? parseRepoSort(sort) : undefined,
		year: yearRaw ? Number(yearRaw) : undefined,
		dateFrom,
		dateTo,
		neverEnriched: url.searchParams.get('never_enriched') === '1',
		archivedOnly: url.searchParams.get('archived_only') === '1',
		hasReadme: url.searchParams.get('has_readme') === '1',
		hasRelease: url.searchParams.get('has_release') === '1',
		deletedOnly,
		includeDeleted: deletedOnly,
		minStars: minStarsRaw ? Number(minStarsRaw) : feedMinStars,
		maxStars: maxStarsRaw ? Number(maxStarsRaw) : undefined,
		minForks: minForksRaw ? Number(minForksRaw) : undefined,
		category,
		signalTier,
		minInterestingScore: minInterestingRaw ? Number(minInterestingRaw) : undefined,
		cluster,
		clusters,
		clusterMatch,
		minClusterConfidence: minClusterConfidenceRaw ? Number(minClusterConfidenceRaw) : undefined,
		page: Number(url.searchParams.get('page') ?? 1),
		perPage: parseRepoPageSize(url.searchParams.get('per_page'))
	};
}

export function repoQueryFiltersForUi(opts: RepoQuery) {
	return {
		q: opts.q ?? '',
		language: opts.language ?? '',
		source: opts.source ?? '',
		sort: opts.sort ?? 'newest_discovered',
		feed: opts.feed ?? 'newest',
		year: opts.year ? String(opts.year) : '',
		dateFrom: opts.dateFrom ?? '',
		dateTo: opts.dateTo ?? '',
		neverEnriched: opts.neverEnriched ?? false,
		archivedOnly: opts.archivedOnly ?? false,
		hasReadme: opts.hasReadme ?? false,
		hasRelease: opts.hasRelease ?? false,
		deletedOnly: opts.deletedOnly ?? false,
		minStars: opts.minStars ? String(opts.minStars) : '',
		maxStars: opts.maxStars ? String(opts.maxStars) : '',
		minForks: opts.minForks ? String(opts.minForks) : '',
		category: opts.category ?? '',
		signalTier: opts.signalTier ?? '',
		minInterestingScore: opts.minInterestingScore ? String(opts.minInterestingScore) : '',
		cluster: opts.cluster ?? '',
		clusters: opts.clusters?.join(',') ?? '',
		clusterMatch: opts.clusterMatch ?? '',
		minClusterConfidence: opts.minClusterConfidence ? String(opts.minClusterConfidence) : '',
		page: opts.page ?? 1,
		perPage: parseRepoPageSize(opts.perPage)
	};
}
