import { getAvailableLanguages } from '$lib/server/repos';
import { getBirthFeedSources, listBirthFeed } from '$lib/server/birth-feed';
import { getLiveOverview, getTrendSnapshot } from '$lib/server/intelligence';
import { parseRepoQueryParams, repoQueryFiltersForUi } from '$lib/server/repo-search';
import { REPO_SORTS } from '$lib/server/db/repo-query';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const base = parseRepoQueryParams(url);
	const opts = {
		...base,
		source: base.source,
		archivedOnly: base.archivedOnly,
		hasReadme: base.hasReadme,
		hasRelease: base.hasRelease,
		sort: base.sort ?? 'newest_discovered'
	};
	const result = listBirthFeed(opts);
	const languages = getAvailableLanguages();
	const sources = getBirthFeedSources();

	return {
		...result,
		languages,
		sources,
		sorts: REPO_SORTS,
		trends: getTrendSnapshot(),
		overview: getLiveOverview(),
		filters: {
			...repoQueryFiltersForUi(base),
			archivedOnly: base.archivedOnly ?? false,
			hasReadme: base.hasReadme ?? false,
			hasRelease: base.hasRelease ?? false
		}
	};
};
