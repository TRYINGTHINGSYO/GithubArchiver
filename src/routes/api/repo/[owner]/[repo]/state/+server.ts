import { error, json } from '@sveltejs/kit';
import { getRepoWithSnapshots } from '$lib/server/repos';
import { getRepoState, getRepoStateNow } from '$lib/server/repo-state';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const data = getRepoWithSnapshots(params.owner, params.repo);
	if (!data) {
		throw error(404, `Repository ${params.owner}/${params.repo} not found`);
	}

	const asOfParam = url.searchParams.get('as_of');
	const state = asOfParam
		? getRepoState(data.repo.id, asOfParam)
		: getRepoStateNow(data.repo.id);

	return json({
		repo: {
			id: data.repo.id,
			full_name: data.repo.full_name,
			owner: data.repo.owner,
			name: data.repo.name
		},
		state
	});
};
