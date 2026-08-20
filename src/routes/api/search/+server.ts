import { json } from '@sveltejs/kit';
import { listReposSearchAware } from '$lib/server/repos';
import { parseRepoQueryParams } from '$lib/server/repo-search';
import { getSemanticConfig, isSemanticSearchEnabled } from '$lib/server/semantic/config';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	if (!q.trim()) {
		return json({ error: 'q parameter is required' }, { status: 400 });
	}

	const opts = parseRepoQueryParams(url);
	const config = getSemanticConfig();
	const searchMode =
		opts.searchMode ?? (isSemanticSearchEnabled() ? config.defaultMode : 'keyword');
	const result = await listReposSearchAware({ ...opts, q, searchMode });

	return json(result);
};
