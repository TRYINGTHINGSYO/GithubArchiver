import { error, json } from '@sveltejs/kit';
import { getArchiveSnapshotById, getRepoBySlug, listArchiveSnapshots } from '$lib/server/db';
import { readSourceFileFromSnapshot } from '$lib/server/source-archive';
import { languageClassForPath } from '$lib/server/source-browser';
import type { RequestHandler } from './$types';

const MAX_INLINE_BYTES = Number(process.env.SOURCE_FILE_MAX_BYTES ?? 512_000);

export const GET: RequestHandler = async ({ params, url }) => {
	const filePath = url.searchParams.get('path')?.trim();
	if (!filePath) throw error(400, 'Missing path query parameter');

	const repo = getRepoBySlug(params.owner, params.repo);
	if (!repo) throw error(404, 'Repository not found');

	const snapshots = listArchiveSnapshots(repo.id).filter((s) => s.snapshot_type === 'source');
	const snapshot = snapshots[0];
	if (!snapshot) throw error(404, 'No source snapshot archived yet');

	const row = getArchiveSnapshotById(snapshot.id);
	if (!row) throw error(404, 'Snapshot not found');

	const { content, binary, error: readError } = readSourceFileFromSnapshot(row, filePath);
	if (readError) throw error(404, readError);
	if (!content) throw error(404, 'File not found');

	if (binary) {
		return json({
			path: filePath,
			binary: true,
			language: null,
			size: content.length,
			message: 'Binary file — download the archive ZIP to view locally.'
		});
	}

	if (content.length > MAX_INLINE_BYTES) {
		return json({
			path: filePath,
			binary: false,
			language: languageClassForPath(filePath),
			size: content.length,
			truncated: true,
			content: content.subarray(0, MAX_INLINE_BYTES).toString('utf8'),
			message: `File is ${content.length.toLocaleString()} bytes; showing first ${MAX_INLINE_BYTES.toLocaleString()} bytes.`
		});
	}

	return json({
		path: filePath,
		binary: false,
		language: languageClassForPath(filePath),
		size: content.length,
		truncated: false,
		content: content.toString('utf8')
	});
};
