import { json } from '@sveltejs/kit';
import {
	createBackfillJob,
	getActiveBackfillJob,
	getBackfillJob,
	getBackfillProgress,
	listBackfillJobs
} from '$lib/server/db/backfill';
import { runBackfillResumeJob } from '$lib/server/job-runner';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const active = getActiveBackfillJob();
	return json({
		active,
		progress: active ? getBackfillProgress(active.id) : null,
		jobs: listBackfillJobs(20)
	});
};

export const POST: RequestHandler = async ({ request, url }) => {
	const resume = url.pathname.endsWith('/resume') || url.searchParams.get('resume') === '1';

	if (resume) {
		const active = getActiveBackfillJob();
		const result = runBackfillResumeJob(active?.id);
		return json(
			{ ok: result.queued, jobId: active?.id ?? null, ...result },
			{ status: result.queued ? 200 : 409 }
		);
	}

	const body = (await request.json()) as {
		start_date?: string;
		end_date?: string;
		source?: string;
		max_hours_per_run?: number;
		run_now?: boolean;
	};

	if (!body.start_date || !body.end_date) {
		return json({ error: 'start_date and end_date required' }, { status: 400 });
	}

	const source =
		body.source === 'gharchive' || body.source === 'github_search' || body.source === 'auto'
			? body.source
			: 'auto';

	const jobId = createBackfillJob({
		startDate: body.start_date,
		endDate: body.end_date,
		source,
		maxHoursPerRun: body.max_hours_per_run ?? 6
	});

	if (body.run_now) {
		const result = runBackfillResumeJob(jobId);
		return json(
			{ ok: result.queued, jobId, job: getBackfillJob(jobId), ...result },
			{ status: result.queued ? 200 : 409 }
		);
	}

	return json({ ok: true, jobId, job: getBackfillJob(jobId) });
};
