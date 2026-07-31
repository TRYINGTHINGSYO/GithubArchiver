import { error } from '@sveltejs/kit';
import { queueLiveMetadataRefreshOnView } from '$lib/server/repo-view-refresh';
import { getRepoWithSnapshots } from '$lib/server/repos';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
	const started = performance.now();

	const dbStarted = performance.now();
	const data = getRepoWithSnapshots(params.owner, params.repo);
	const dbMs = Math.round((performance.now() - dbStarted) * 10) / 10;
	if (!data) {
		throw error(404, `Repository ${params.owner}/${params.repo} not found`);
	}

	const queueStarted = performance.now();
	const liveMetadataRefresh = queueLiveMetadataRefreshOnView(data.repo);
	const queueMs = Math.round((performance.now() - queueStarted) * 10) / 10;
	const totalMs = Math.round((performance.now() - started) * 10) / 10;

	setHeaders({
		'cache-control': 'private, max-age=60, stale-while-revalidate=300',
		'server-timing': `db;dur=${dbMs}, refresh_queue;dur=${queueMs}, total;dur=${totalMs}`
	});
	return {
		...data,
		liveMetadataRefresh,
		isAdmin: locals.isAdmin
	};
};
