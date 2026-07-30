import type { RequestHandler } from './$types';

/** Lightweight liveness for Railway — must not start the daemon or touch heavy queries. */
export const GET: RequestHandler = async () => {
	return new Response('ok', {
		status: 200,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store'
		}
	});
};
