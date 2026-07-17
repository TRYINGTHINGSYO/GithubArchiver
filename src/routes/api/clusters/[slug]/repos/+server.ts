import { error, json } from '@sveltejs/kit';
import { getClusterDetail, getClusterRepos } from '$lib/server/clusters';
import { ensureClusterRegistry } from '$lib/server/db/clusters';
import { parseRepoQueryParams } from '$lib/server/repo-search';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	ensureClusterRegistry();
	const cluster = getClusterDetail(params.slug);
	if (!cluster) error(404, 'Cluster not found');

	const opts = parseRepoQueryParams(url);
	const result = getClusterRepos(params.slug, {
		...opts,
		cluster: params.slug,
		minClusterConfidence: opts.minClusterConfidence ?? 0
	});
	if (!result) error(404, 'Cluster not found');

	return json({ cluster, ...result });
};
