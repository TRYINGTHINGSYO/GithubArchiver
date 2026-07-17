import type { RequestHandler } from './$types';
import {
	buildRepoNamesJsonExport,
	buildRepoNamesTextExport,
	type RepoNamesScope
} from '$lib/server/repo-names-export';

function parseScope(value: string | null): RepoNamesScope {
	if (value === 'active' || value === 'deleted' || value === 'all') return value;
	return 'all';
}

/** Download all repo names (plus AI analysis prompt) as txt or json. */
export const GET: RequestHandler = async ({ url }) => {
	const scope = parseScope(url.searchParams.get('scope'));
	const format = url.searchParams.get('format') ?? 'txt';

	if (format !== 'json' && format !== 'txt') {
		return new Response(JSON.stringify({ error: 'format must be txt or json' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const built =
		format === 'json' ? buildRepoNamesJsonExport(scope) : buildRepoNamesTextExport(scope);
	const contentType = format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';

	return new Response(built.body, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': `attachment; filename="${built.filename}"`,
			'Cache-Control': 'no-store',
			'X-Repo-Count': String(built.count)
		}
	});
};
