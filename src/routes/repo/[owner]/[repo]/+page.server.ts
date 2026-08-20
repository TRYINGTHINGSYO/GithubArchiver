import { error } from '@sveltejs/kit';
import { queueLiveMetadataRefreshOnView } from '$lib/server/repo-view-refresh';
import { getRepoWithSnapshots } from '$lib/server/repos';
import { findSimilarRepositories } from '$lib/server/semantic/similar';
import { isSemanticSearchEnabled } from '$lib/server/semantic/config';
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

	let similar: Array<{
		id: number;
		owner: string;
		name: string;
		full_name: string;
		description: string | null;
		language: string | null;
		stars: number | null;
		semantic_score: number;
	}> = [];
	if (isSemanticSearchEnabled()) {
		try {
			const hits = await findSimilarRepositories(data.repo.id, 8);
			similar = hits.map((h) => ({
				id: h.repo.id,
				owner: h.repo.owner,
				name: h.repo.name,
				full_name: h.repo.full_name,
				description: h.repo.description,
				language: h.repo.language,
				stars: h.repo.stars,
				semantic_score: h.semanticScore
			}));
		} catch {
			similar = [];
		}
	}

	const totalMs = Math.round((performance.now() - started) * 10) / 10;

	setHeaders({
		'cache-control': 'private, max-age=60, stale-while-revalidate=300',
		'server-timing': `db;dur=${dbMs}, refresh_queue;dur=${queueMs}, total;dur=${totalMs}`
	});
	return {
		...data,
		similar,
		liveMetadataRefresh,
		isAdmin: locals.isAdmin
	};
};
