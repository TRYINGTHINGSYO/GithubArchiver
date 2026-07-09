import { getAvailableLanguages, listRepos, getRepoStats } from '$lib/server/repos';
import { getArchivePulse } from '$lib/server/db';
import { parseRepoQueryParams, repoQueryFiltersForUi } from '$lib/server/repo-search';
import { REPO_SORTS } from '$lib/server/db/repo-query';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const opts = parseRepoQueryParams(url);
	const result = listRepos(opts);
	const stats = getRepoStats();
	const languages = getAvailableLanguages();
	const archivePulse = getArchivePulse();
	const newRepos = listRepos({ sort: 'newest_discovered', page: 1, perPage: 6 });
	const newStarredRepos = listRepos({ sort: 'newest_discovered', minStars: 100, page: 1, perPage: 6 });

	return {
		...result,
		stats,
		archivePulse,
		discoveryLanes: {
			newRepos: newRepos.repos,
			newStarredRepos: newStarredRepos.repos
		},
		languages,
		sorts: REPO_SORTS,
		filters: repoQueryFiltersForUi(opts),
		isAdmin: locals.isAdmin
	};
};
