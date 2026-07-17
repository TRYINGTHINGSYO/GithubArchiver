import { json } from '@sveltejs/kit';
import { getDaemonActivity } from '$lib/server/daemon-activity';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json(getDaemonActivity());
};
