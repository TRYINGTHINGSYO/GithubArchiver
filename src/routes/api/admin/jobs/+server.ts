import { json } from '@sveltejs/kit';
import { getJobRunById, listJobRuns } from '$lib/server/db/jobs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const id = Number(url.searchParams.get('id'));
	if (id > 0) {
		const job = getJobRunById(id);
		if (!job) return json({ error: 'Job not found' }, { status: 404 });
		return json({ job });
	}

	const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
	const offset = Number(url.searchParams.get('offset') ?? 0);
	const jobType = url.searchParams.get('type') ?? undefined;

	return json({
		jobs: listJobRuns({ limit, offset, jobType })
	});
};
