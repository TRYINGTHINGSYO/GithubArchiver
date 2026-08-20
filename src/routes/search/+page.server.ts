import { REPO_SORTS } from '$lib/server/db/repo-query';
import { getAvailableLanguages, listReposSearchAware } from '$lib/server/repos';
import { parseRepoQueryParams, repoQueryFiltersForUi } from '$lib/server/repo-search';
import { getSemanticConfig, isSemanticSearchEnabled } from '$lib/server/semantic/config';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, setHeaders, url }) => {
	const started = performance.now();
	const opts = parseRepoQueryParams(url);
	const config = getSemanticConfig();
	const searchMode =
		opts.searchMode ?? (isSemanticSearchEnabled() ? config.defaultMode : 'keyword');
	const dbStarted = performance.now();
	const result = await listReposSearchAware({ ...opts, searchMode });
	const dbMs = Math.round((performance.now() - dbStarted) * 10) / 10;
	const languagesStarted = performance.now();
	const languages = getAvailableLanguages();
	const languagesMs = Math.round((performance.now() - languagesStarted) * 10) / 10;
	const totalMs = Math.round((performance.now() - started) * 10) / 10;

	setHeaders({
		'cache-control': 'private, max-age=30, stale-while-revalidate=120',
		'server-timing': `db;dur=${dbMs}, languages;dur=${languagesMs}, total;dur=${totalMs}`
	});

	return {
		...result,
		languages,
		sorts: REPO_SORTS,
		filters: repoQueryFiltersForUi({ ...opts, searchMode }),
		semanticEnabled: isSemanticSearchEnabled(),
		isAdmin: locals.isAdmin
	};
};
