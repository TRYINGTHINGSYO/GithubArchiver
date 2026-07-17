import { json } from '@sveltejs/kit';
import { getFastestGrowingClusters, parseDiscoveryQuery } from '$lib/server/discovery';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const query = parseDiscoveryQuery(url);
	return json({
		clusters: getFastestGrowingClusters(query),
		query
	});
};
