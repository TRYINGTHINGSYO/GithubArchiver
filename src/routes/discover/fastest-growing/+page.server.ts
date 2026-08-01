import {
	getClusterSurfaceState,
	getFastestGrowingClusters,
	parseDiscoveryQuery
} from '$lib/server/discovery';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const query = parseDiscoveryQuery(url);
	const clusters = getFastestGrowingClusters(query);
	return {
		query,
		clusters,
		clusterSurface: getClusterSurfaceState(clusters.length > 0)
	};
};
