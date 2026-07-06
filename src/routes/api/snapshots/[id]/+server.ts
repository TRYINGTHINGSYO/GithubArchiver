import { readFileSync } from 'node:fs';
import {
	getSnapshotForDownload,
	snapshotContentType,
	snapshotDownloadFilename
} from '$lib/server/snapshots';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id) || id <= 0) {
		return new Response(JSON.stringify({ error: 'Invalid snapshot id' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const result = getSnapshotForDownload(id);
	if (!result) {
		return new Response(JSON.stringify({ error: 'Snapshot not found or file missing' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const { snapshot, safePath } = result;
	const body = readFileSync(safePath);
	const filename = snapshotDownloadFilename(snapshot, safePath);

	return new Response(body, {
		headers: {
			'Content-Type': snapshotContentType(snapshot),
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Content-Length': String(body.length),
			'X-Snapshot-Id': String(snapshot.id),
			'X-Snapshot-Sha256': snapshot.sha256,
			'Cache-Control': 'private, max-age=3600'
		}
	});
};
