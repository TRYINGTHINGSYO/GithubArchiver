import { createReadStream, existsSync, statSync } from 'node:fs';
import { getBulkExportZipPath } from '$lib/server/bulk-export';
import { getJobRunById } from '$lib/server/db/jobs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const jobId = Number(params.jobId);
	if (!Number.isFinite(jobId) || jobId <= 0) {
		return new Response(JSON.stringify({ error: 'Invalid job id' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const job = getJobRunById(jobId);
	if (!job || job.job_type !== 'export') {
		return new Response(JSON.stringify({ error: 'Export job not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (job.status !== 'success') {
		return new Response(JSON.stringify({ error: `Export job is ${job.status}` }), {
			status: 409,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const zipPath = getBulkExportZipPath(jobId);
	if (!existsSync(zipPath)) {
		return new Response(JSON.stringify({ error: 'Export file missing on disk' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const size = statSync(zipPath).size;
	const stream = createReadStream(zipPath);

	return new Response(stream as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="githubarchive-bulk-export-${jobId}.zip"`,
			'Content-Length': String(size),
			'Cache-Control': 'private, no-store'
		}
	});
};
