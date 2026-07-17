import { getFastestGrowingClusters, parseDiscoveryQuery } from '$lib/server/discovery';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const query = parseDiscoveryQuery(url);
	return {
		query,
		clusters: getFastestGrowingClusters(query)
	};
};
