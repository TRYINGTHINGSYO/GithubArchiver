import { json } from '@sveltejs/kit';
import { getProjectsToWatch, parseDiscoveryQuery } from '$lib/server/discovery';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const query = parseDiscoveryQuery(url);
	return json({
		repos: getProjectsToWatch(query),
		query
	});
};
