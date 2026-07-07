import { error, json } from '@sveltejs/kit';
import { getArchiveSnapshotById, getRepoBySlug, listArchiveSnapshots } from '$lib/server/db';
import { analyzeSourceSnapshot, readSourceFileFromSnapshot } from '$lib/server/source-archive';
import { buildFileTree, languageClassForPath } from '$lib/server/source-browser';
import type { RequestHandler } from './$types';

function latestBrowsableSourceSnapshot(repoId: number) {
	const snapshots = listArchiveSnapshots(repoId).filter((s) => s.snapshot_type === 'source');
	return snapshots[0] ?? null;
}

export const GET: RequestHandler = async ({ params }) => {
	const repo = getRepoBySlug(params.owner, params.repo);
	if (!repo) throw error(404, 'Repository not found');

	const snapshot = latestBrowsableSourceSnapshot(repo.id);
	if (!snapshot) {
		return json({ available: false, tree: [], snapshot_id: null, file_count: 0 });
	}

	const row = getArchiveSnapshotById(snapshot.id);
	if (!row) throw error(404, 'Snapshot not found');

	const analysis = analyzeSourceSnapshot(row);
	if (!analysis?.available) {
		return json({
			available: false,
			tree: [],
			snapshot_id: snapshot.id,
			file_count: 0,
			error: analysis?.error ?? 'Could not read source archive.'
		});
	}

	return json({
		available: true,
		snapshot_id: snapshot.id,
		file_count: analysis.file_count,
		truncated: analysis.truncated,
		tree: buildFileTree(analysis.files, analysis.folders)
	});
};
