import { redirect } from '@sveltejs/kit';
import { clearAdminSessionCookie } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	clearAdminSessionCookie(cookies);
	throw redirect(303, '/');
};
