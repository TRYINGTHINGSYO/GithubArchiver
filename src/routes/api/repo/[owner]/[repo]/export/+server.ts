import { redirect } from '@sveltejs/kit';
import { getLatestArchiveSnapshot } from '$lib/server/db/archive';
import { getRepoBySlug } from '$lib/server/db/repos';
import { archiveRepo, getArchiveConfigFromEnv } from '$lib/server/archiver';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const snapshotType = url.searchParams.get('type') === 'readme' ? 'readme' : 'source';
	const repo = getRepoBySlug(params.owner, params.repo);

	if (!repo) {
		return new Response(JSON.stringify({ error: 'Repository not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!repo.enriched_at || !repo.default_branch) {
		return new Response(JSON.stringify({ error: 'Repository not enriched yet' }), {
			status: 409,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let snapshot = getLatestArchiveSnapshot(repo.id, snapshotType);

	if (!snapshot) {
		await archiveRepo(repo, getArchiveConfigFromEnv(), { captureReason: 'export' });
		snapshot = getLatestArchiveSnapshot(repo.id, snapshotType);
	}

	if (!snapshot) {
		return new Response(JSON.stringify({ error: 'Snapshot could not be created' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	throw redirect(302, `/api/snapshots/${snapshot.id}`);
};
