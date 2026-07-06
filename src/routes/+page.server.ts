import { getAvailableLanguages, listRepos, getRepoStats } from '$lib/server/repos';
import { parseRepoQueryParams, repoQueryFiltersForUi } from '$lib/server/repo-search';
import { REPO_SORTS } from '$lib/server/db/repo-query';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const opts = parseRepoQueryParams(url);
	const result = listRepos(opts);
	const stats = getRepoStats();
	const languages = getAvailableLanguages();

	return {
		...result,
		stats,
		languages,
		sorts: REPO_SORTS,
		filters: repoQueryFiltersForUi(opts)
	};
};
