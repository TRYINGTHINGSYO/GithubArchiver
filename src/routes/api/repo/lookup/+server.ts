import { json } from '@sveltejs/kit';
import { lookupRepo } from '$lib/server/repo-save';
import type { RequestHandler } from './$types';

/** Preview a repo from local DB or live GitHub (no write). */
export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const result = await lookupRepo(q);
	return json(result, { status: result.found || result.message ? 200 : 400 });
};
