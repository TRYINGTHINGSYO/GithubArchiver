import { error } from '@sveltejs/kit';
import { getRepoTimeline } from '$lib/server/repos';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const data = getRepoTimeline(params.owner, params.repo);
	if (!data) {
		throw error(404, `Repository ${params.owner}/${params.repo} not found`);
	}
	return data;
};
