import { json } from '@sveltejs/kit';
import { getAvailableLanguages, getRepoStats, listRepos } from '$lib/server/repos';
import { parseRepoQueryParams } from '$lib/server/repo-search';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const opts = parseRepoQueryParams(url);
	const result = listRepos(opts);
	const stats = getRepoStats();
	const languages = getAvailableLanguages();

	return json({ ...result, stats, languages });
};
