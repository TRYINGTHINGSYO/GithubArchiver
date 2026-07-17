import { json } from '@sveltejs/kit';
import { getAllClustersWithAnalytics } from '$lib/server/clusters';
import { ensureClusterRegistry } from '$lib/server/db/clusters';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	ensureClusterRegistry();
	const clusters = getAllClustersWithAnalytics();
	return json({ clusters });
};
