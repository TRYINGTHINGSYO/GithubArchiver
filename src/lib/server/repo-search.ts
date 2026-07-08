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
	const minForksRaw = url.searchParams.get('min_forks');

	const deletedOnly =
		url.searchParams.get('deleted_only') === '1' || feed === 'recently_deleted';

	return {
		q,
		language,
		source:
			source === 'gharchive' || source === 'github_search' ? source : undefined,
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
		minStars: minStarsRaw ? Number(minStarsRaw) : undefined,
		minForks: minForksRaw ? Number(minForksRaw) : undefined,
		page: Number(url.searchParams.get('page') ?? 1),
		perPage: parseRepoPageSize(url.searchParams.get('per_page'))
	};
}

export function repoQueryFiltersForUi(opts: RepoQuery) {
	return {
		q: opts.q ?? '',
		language: opts.language ?? '',
		source: opts.source ?? '',
		sort: opts.sort ?? opts.feed ?? 'newest_discovered',
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
		minForks: opts.minForks ? String(opts.minForks) : '',
		page: opts.page ?? 1,
		perPage: parseRepoPageSize(opts.perPage)
	};
}
