import { error } from '@sveltejs/kit';
import { getRepoBySlug } from '$lib/server/db';
import { enrichRepo, refreshRepo } from '$lib/server/enrich';
import { getRepoWithSnapshots } from '$lib/server/repos';
import { isMetadataOnlyMode } from '$lib/server/runtime-mode';
import type { PageServerLoad } from './$types';

const LIVE_REFRESH_INTERVAL_MS = Number(process.env.LIVE_REPO_REFRESH_INTERVAL_MS ?? 15 * 60 * 1000);

function shouldRefreshLiveMetadata(repo: NonNullable<ReturnType<typeof getRepoBySlug>>): boolean {
	if (!isMetadataOnlyMode()) return false;
	if (LIVE_REFRESH_INTERVAL_MS <= 0) return false;
	if (!repo.enriched_at || !repo.last_checked_at) return true;
	return Date.now() - new Date(repo.last_checked_at).getTime() >= LIVE_REFRESH_INTERVAL_MS;
}

async function refreshLiveMetadataOnView(owner: string, name: string): Promise<void> {
	const repo = getRepoBySlug(owner, name);
	if (!repo || !shouldRefreshLiveMetadata(repo)) return;

	try {
		if (repo.enriched_at) {
			await refreshRepo(repo);
		} else {
			await enrichRepo(repo);
		}
	} catch (err) {
		console.warn(
			`[repo] live metadata refresh failed for ${owner}/${name}: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
	}
}

export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
	await refreshLiveMetadataOnView(params.owner, params.repo);

	const data = getRepoWithSnapshots(params.owner, params.repo);
	if (!data) {
		throw error(404, `Repository ${params.owner}/${params.repo} not found`);
	}
	setHeaders({
		'cache-control': 'private, max-age=60, stale-while-revalidate=300'
	});
	return {
		...data,
		isAdmin: locals.isAdmin
	};
};
