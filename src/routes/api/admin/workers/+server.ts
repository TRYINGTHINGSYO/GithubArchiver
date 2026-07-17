import { json } from '@sveltejs/kit';
import {
	runArchiveJob,
	runEnrichJob,
	runIngestHourJob,
	runIngestMissingJob,
	runPipelineJob,
	runRefreshJob,
	runSearchIngestJob,
	runTrendingIngestJob,
	runBackupJob
} from '$lib/server/job-runner';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		action?: string;
		hour_key?: string;
		include_archives?: boolean;
		compress?: boolean;
	};

	const action = body.action ?? '';

	switch (action) {
		case 'pipeline': {
			const result = runPipelineJob();
			return json({ ok: result.queued, ...result }, { status: result.queued ? 200 : 409 });
		}
		case 'ingest': {
			const result = runIngestHourJob(body.hour_key);
			return json({ ok: result.queued, ...result }, { status: result.queued ? 200 : 409 });
		}
		case 'ingest-missing': {
			const result = runIngestMissingJob();
			return json({ ok: result.queued, ...result }, { status: result.queued ? 200 : 409 });
		}
		case 'search-ingest': {
			const result = runSearchIngestJob(body.hour_key);
			return json({ ok: result.queued, ...result }, { status: result.queued ? 200 : 409 });
		}
		case 'trending-ingest': {
			const result = runTrendingIngestJob();
			return json({ ok: result.queued, ...result }, { status: result.queued ? 200 : 409 });
		}
		case 'enrich': {
			const result = runEnrichJob();
			return json({ ok: result.queued, ...result }, { status: result.queued ? 200 : 409 });
		}
		case 'archive': {
			const result = runArchiveJob();
			return json({ ok: result.queued, ...result }, { status: result.queued ? 200 : 409 });
		}
		case 'refresh': {
			const result = runRefreshJob();
			return json({ ok: result.queued, ...result }, { status: result.queued ? 200 : 409 });
		}
		case 'backup': {
			const result = runBackupJob({
				includeArchives: body.include_archives ?? false,
				compress: body.compress ?? false
			});
			return json({ ok: result.queued, ...result }, { status: result.queued ? 200 : 409 });
		}
		default:
			return json({ error: `Unknown action: ${action}` }, { status: 400 });
	}
};
