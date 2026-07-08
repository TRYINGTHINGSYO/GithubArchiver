import { redirect } from '@sveltejs/kit';
import { getLatestArchiveSnapshot } from '$lib/server/db/archive';
import { getRepoBySlug } from '$lib/server/db/repos';
import { archiveRepo, getArchiveConfigFromEnv } from '$lib/server/archiver';
import { ensureZipForLatestSource } from '$lib/server/source-zip';
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

	if (snapshotType === 'source') {
		let zipSnapshot = getLatestArchiveSnapshot(repo.id, 'zip');

		if (!zipSnapshot) {
			const sourceSnapshot = getLatestArchiveSnapshot(repo.id, 'source');
			if (sourceSnapshot) {
				await ensureZipForLatestSource(repo, 'export');
			} else {
				await archiveRepo(
					repo,
					{ ...getArchiveConfigFromEnv(), createZipSnapshot: true },
					{ captureReason: 'export' }
				);
			}
			zipSnapshot = getLatestArchiveSnapshot(repo.id, 'zip');
		}

		if (zipSnapshot) {
			throw redirect(302, `/api/snapshots/${zipSnapshot.id}`);
		}

		let sourceSnapshot = getLatestArchiveSnapshot(repo.id, 'source');
		if (!sourceSnapshot) {
			await archiveRepo(repo, getArchiveConfigFromEnv(), { captureReason: 'export' });
			sourceSnapshot = getLatestArchiveSnapshot(repo.id, 'source');
		}

		if (!sourceSnapshot) {
			return new Response(JSON.stringify({ error: 'Snapshot could not be created' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		throw redirect(302, `/api/snapshots/${sourceSnapshot.id}`);
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
