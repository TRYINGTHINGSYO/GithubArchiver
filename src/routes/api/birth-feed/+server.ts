import { json } from '@sveltejs/kit';
import { getAvailableLanguages } from '$lib/server/repos';
import { getBirthFeedSources, listBirthFeed } from '$lib/server/birth-feed';
import { parseRepoQueryParams, repoQueryFiltersForUi } from '$lib/server/repo-search';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const base = parseRepoQueryParams(url);
	const result = listBirthFeed({
		...base,
		sort: base.sort ?? 'newest_discovered'
	});
	const languages = getAvailableLanguages();
	const sources = getBirthFeedSources();

	return json({
		...result,
		languages,
		sources,
		filters: repoQueryFiltersForUi(base)
	});
};
