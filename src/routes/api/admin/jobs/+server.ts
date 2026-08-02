import { json } from '@sveltejs/kit';
import { getJobRunById, listJobRuns } from '$lib/server/db/jobs';
import { boundedInteger, positiveInteger } from '$lib/server/number-params';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const id = positiveInteger(url.searchParams.get('id'));
	if (id !== undefined) {
		const job = getJobRunById(id);
		if (!job) return json({ error: 'Job not found' }, { status: 404 });
		return json({ job });
	}

	const limit = boundedInteger(url.searchParams.get('limit'), 50, { min: 1, max: 200 });
	const offset = boundedInteger(url.searchParams.get('offset'), 0, { min: 0, max: 1_000_000 });
	const jobType = url.searchParams.get('type') ?? undefined;

	return json({
		jobs: listJobRuns({ limit, offset, jobType })
	});
};
