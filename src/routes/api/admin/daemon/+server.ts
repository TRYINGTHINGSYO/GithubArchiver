import { json } from '@sveltejs/kit';
import { startDaemon, stopDaemon } from '$lib/server/worker-control';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { action?: string };
	if (body.action === 'start') {
		try {
			const result = startDaemon();
			return json({ ok: true, ...result });
		} catch (err) {
			return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 409 });
		}
	}
	if (body.action === 'stop') {
		const result = stopDaemon();
		return json(
			{ ok: result.stopped, message: result.message },
			{ status: result.stopped ? 200 : 409 }
		);
	}
	return json({ error: 'action must be start or stop' }, { status: 400 });
};
