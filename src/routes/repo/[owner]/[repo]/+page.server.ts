import { error } from '@sveltejs/kit';
import { getRepoWithSnapshots } from '$lib/server/repos';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	const data = getRepoWithSnapshots(params.owner, params.repo);
	if (!data) {
		throw error(404, `Repository ${params.owner}/${params.repo} not found`);
	}
	setHeaders({
		'cache-control': 'private, max-age=60, stale-while-revalidate=300'
	});
	return data;
};
