export interface RepoListFilterState {
	q?: string;
	sort?: string;
	feed?: string;
	language?: string;
	source?: string;
	year?: string | number;
	dateFrom?: string;
	dateTo?: string;
	minStars?: string | number;
	maxStars?: string | number;
	minForks?: string | number;
	neverEnriched?: boolean;
	archivedOnly?: boolean;
	hasReadme?: boolean;
	hasRelease?: boolean;
	deletedOnly?: boolean;
	page?: string | number;
}

export function buildRepoListUrl(
	basePath: string,
	filters: RepoListFilterState,
	overrides: RepoListFilterState = {}
): string {
	const params = new URLSearchParams();
	const f = { ...filters, ...overrides };

	if (f.q) params.set('q', String(f.q));
	if (f.sort && f.sort !== 'newest_discovered') params.set('sort', String(f.sort));
	else if (f.feed && f.feed !== 'newest') params.set('feed', String(f.feed));
	if (f.language) params.set('language', String(f.language));
	if (f.source) params.set('source', String(f.source));
	if (f.year) params.set('year', String(f.year));
	if (f.dateFrom) params.set('date_from', String(f.dateFrom));
	if (f.dateTo) params.set('date_to', String(f.dateTo));
	if (f.minStars) params.set('min_stars', String(f.minStars));
	if (f.maxStars) params.set('max_stars', String(f.maxStars));
	if (f.minForks) params.set('min_forks', String(f.minForks));
	if (f.neverEnriched) params.set('never_enriched', '1');
	if (f.archivedOnly) params.set('archived_only', '1');
	if (f.hasReadme) params.set('has_readme', '1');
	if (f.hasRelease) params.set('has_release', '1');
	if (f.deletedOnly) params.set('deleted_only', '1');
	if (f.page && Number(f.page) > 1) params.set('page', String(f.page));

	const qs = params.toString();
	return qs ? `${basePath}?${qs}` : basePath;
}

export function hasAdvancedFilters(filters: RepoListFilterState): boolean {
	return Boolean(
		filters.source ||
			filters.year ||
			filters.dateFrom ||
			filters.dateTo ||
			filters.maxStars ||
			filters.minForks ||
			filters.neverEnriched ||
			filters.hasReadme ||
			filters.hasRelease ||
			(filters.sort && filters.sort !== 'newest_discovered' && filters.sort !== filters.feed)
	);
}

export function hasAnyRepoFilters(filters: RepoListFilterState): boolean {
	return Boolean(
		filters.q ||
			filters.language ||
			filters.source ||
			filters.year ||
			filters.dateFrom ||
			filters.dateTo ||
			filters.minStars ||
			filters.maxStars ||
			filters.minForks ||
			filters.neverEnriched ||
			filters.archivedOnly ||
			filters.hasReadme ||
			filters.hasRelease ||
			filters.deletedOnly ||
			(filters.sort && filters.sort !== 'newest_discovered' && filters.sort !== filters.feed) ||
			(filters.feed && filters.feed !== 'newest')
	);
}
