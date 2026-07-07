import { existsSync, readFileSync } from 'node:fs';
import { json } from '@sveltejs/kit';
import { getBulkExportZipPath } from '$lib/server/bulk-export';
import { getJobRunById, parseJobDetail } from '$lib/server/db/jobs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const jobId = Number(params.jobId);
	if (!Number.isFinite(jobId) || jobId <= 0) {
		return json({ error: 'Invalid job id' }, { status: 400 });
	}

	const job = getJobRunById(jobId);
	if (!job || job.job_type !== 'export') {
		return json({ error: 'Export job not found' }, { status: 404 });
	}

	const detail = parseJobDetail(job);
	const downloadReady = job.status === 'success' && existsSync(getBulkExportZipPath(jobId));

	return json({
		job: {
			id: job.id,
			status: job.status,
			started_at: job.started_at,
			finished_at: job.finished_at,
			error: job.error
		},
		detail,
		downloadReady,
		downloadUrl: downloadReady ? `/api/export/bulk/${jobId}/download` : null
	});
};
