import { json } from '@sveltejs/kit';
import { getAdminStatus } from '$lib/server/admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json(await getAdminStatus());
};
