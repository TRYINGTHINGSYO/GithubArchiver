import { json } from '@sveltejs/kit';
import { startBulkExportJob } from '$lib/server/job-runner';
import type { BulkExportScope } from '$lib/server/bulk-export';
import type { RequestHandler } from './$types';

function parseScope(value: string | null): BulkExportScope | null {
	if (value === 'all' || value === 'active' || value === 'deleted') return value;
	return null;
}

/** Start an async bulk export job; poll /api/export/bulk/[jobId] for status. */
export const GET: RequestHandler = async ({ url }) => {
	const scope = parseScope(url.searchParams.get('scope'));
	const format = url.searchParams.get('format') ?? 'zip';

	if (!scope) {
		return json(
			{ error: 'scope is required: all, active, or deleted' },
			{ status: 400 }
		);
	}

	if (format !== 'zip') {
		return json({ error: 'Only format=zip is supported' }, { status: 400 });
	}

	const result = startBulkExportJob(scope, 'zip');
	if (!result.queued || !result.jobId) {
		return json({ error: result.message }, { status: 409 });
	}

	return json({
		jobId: result.jobId,
		status: 'queued',
		scope,
		format: 'zip',
		message: result.message,
		statusUrl: `/api/export/bulk/${result.jobId}`,
		downloadUrl: `/api/export/bulk/${result.jobId}/download`
	});
};
