import { json } from '@sveltejs/kit';
import { getLatestArchiveSnapshot } from '$lib/server/db/archive';
import { getRepoBySlug } from '$lib/server/db/repos';
import { archiveRepo, getArchiveConfigFromEnv } from '$lib/server/archiver';
import { ensureZipForLatestSource } from '$lib/server/source-zip';
import { isMetadataOnlyMode } from '$lib/server/runtime-mode';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, url }) => {
	const snapshotType = url.searchParams.get('type') === 'readme' ? 'readme' : 'source';
	const repo = getRepoBySlug(params.owner, params.repo);

	if (!repo) {
		return json({ error: 'Repository not found' }, { status: 404 });
	}

	if (isMetadataOnlyMode()) {
		return json({ error: 'Archive storage is disabled in metadata-only mode' }, { status: 409 });
	}

	if (!repo.enriched_at || !repo.default_branch) {
		return json({ error: 'Repository not enriched yet' }, { status: 409 });
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
			return json({ ok: true, downloadUrl: `/api/snapshots/${zipSnapshot.id}` });
		}

		let sourceSnapshot = getLatestArchiveSnapshot(repo.id, 'source');
		if (!sourceSnapshot) {
			await archiveRepo(repo, getArchiveConfigFromEnv(), { captureReason: 'export' });
			sourceSnapshot = getLatestArchiveSnapshot(repo.id, 'source');
		}

		if (!sourceSnapshot) {
			return json({ error: 'Snapshot could not be created' }, { status: 404 });
		}

		return json({ ok: true, downloadUrl: `/api/snapshots/${sourceSnapshot.id}` });
	}

	let snapshot = getLatestArchiveSnapshot(repo.id, snapshotType);

	if (!snapshot) {
		await archiveRepo(repo, getArchiveConfigFromEnv(), { captureReason: 'export' });
		snapshot = getLatestArchiveSnapshot(repo.id, snapshotType);
	}

	if (!snapshot) {
		return json({ error: 'Snapshot could not be created' }, { status: 404 });
	}

	return json({ ok: true, downloadUrl: `/api/snapshots/${snapshot.id}` });
};
