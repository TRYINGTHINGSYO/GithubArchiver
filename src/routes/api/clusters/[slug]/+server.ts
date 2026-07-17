import { error, json } from '@sveltejs/kit';
import { getClusterDetail } from '$lib/server/clusters';
import { ensureClusterRegistry } from '$lib/server/db/clusters';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	ensureClusterRegistry();
	const cluster = getClusterDetail(params.slug);
	if (!cluster) error(404, 'Cluster not found');
	return json({ cluster });
};
