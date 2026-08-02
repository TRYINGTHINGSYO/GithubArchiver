import { error, json } from '@sveltejs/kit';
import { getRepoTimeline } from '$lib/server/repos';
import { boundedInteger } from '$lib/server/number-params';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const limit = boundedInteger(url.searchParams.get('limit'), 200, { min: 1, max: 500 });
	const data = getRepoTimeline(params.owner, params.repo, limit);
	if (!data) {
		throw error(404, `Repository ${params.owner}/${params.repo} not found`);
	}
	return json(data);
};
