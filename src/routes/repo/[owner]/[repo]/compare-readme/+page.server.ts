import { error } from '@sveltejs/kit';
import { getArchiveSnapshotForRepo, getRepoBySlug } from '$lib/server/db';
import { enrichSnapshotMeta, readSnapshotText } from '$lib/server/snapshots';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const repo = getRepoBySlug(params.owner, params.repo);
	if (!repo) {
		throw error(404, `Repository ${params.owner}/${params.repo} not found`);
	}

	const fromId = Number(url.searchParams.get('from'));
	const toId = Number(url.searchParams.get('to'));

	if (!Number.isFinite(fromId) || !Number.isFinite(toId)) {
		throw error(400, 'from and to snapshot ids are required');
	}

	const fromSnap = getArchiveSnapshotForRepo(repo.id, fromId);
	const toSnap = getArchiveSnapshotForRepo(repo.id, toId);

	if (!fromSnap || !toSnap) {
		throw error(404, 'Snapshot not found for this repository');
	}
	if (fromSnap.snapshot_type !== 'readme' || toSnap.snapshot_type !== 'readme') {
		throw error(400, 'Only README snapshots can be compared');
	}

	const fromText = readSnapshotText(fromSnap);
	const toText = readSnapshotText(toSnap);

	if (fromText === null || toText === null) {
		throw error(404, 'One or both snapshot files are missing on disk');
	}

	return {
		repo: { owner: repo.owner, name: repo.name, full_name: repo.full_name },
		from: enrichSnapshotMeta(fromSnap),
		to: enrichSnapshotMeta(toSnap),
		fromHtml: renderMarkdownSafe(fromText),
		toHtml: renderMarkdownSafe(toText),
		diff: diffLines(fromText, toText)
	};
};
