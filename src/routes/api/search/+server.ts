import { json } from '@sveltejs/kit';
import { listRepos } from '$lib/server/repos';
import { parseRepoQueryParams } from '$lib/server/repo-search';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	if (!q.trim()) {
		return json({ error: 'q parameter is required' }, { status: 400 });
	}

	const opts = parseRepoQueryParams(url);
	const result = listRepos({ ...opts, q });

	return json(result);
};
