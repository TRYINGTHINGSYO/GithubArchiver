import { json } from '@sveltejs/kit';
import { summarizeDaemonDecisions } from '$lib/server/db/daemon-decisions';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours') ?? 24)));
	if (!Number.isFinite(hours)) {
		return json({ error: 'hours must be a number' }, { status: 400 });
	}
	return json(summarizeDaemonDecisions(hours));
};
