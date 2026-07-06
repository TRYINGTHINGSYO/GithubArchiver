import { json } from '@sveltejs/kit';
import { runPipelineNow, runWorkerJob } from '$lib/server/worker-control';
import type { RequestHandler } from './$types';

const WORKERS: Record<string, string> = {
	pipeline: 'pipeline:once',
	ingest: 'ingest:hour',
	enrich: 'enrich:repos',
	archive: 'archive:repos',
	refresh: 'enrich:refresh'
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { action?: string };
	const action = body.action ?? '';

	if (action === 'pipeline') {
		const result = runPipelineNow();
		return json({ ok: true, ...result });
	}

	const script = WORKERS[action];
	if (!script) {
		return json({ error: `Unknown action: ${action}` }, { status: 400 });
	}

	const result = runWorkerJob(script);
	return json({ ok: true, action, ...result });
};
