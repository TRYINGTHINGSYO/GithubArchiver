import { redirect } from '@sveltejs/kit';
import { clearAdminSessionCookie } from '$lib/server/auth/admin-password';
import { isAuthConfigured } from '$lib/server/auth/runtime';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	clearAdminSessionCookie(cookies);
	if (isAuthConfigured()) {
		throw redirect(303, '/auth/signout?callbackUrl=%2F');
	}
	throw redirect(303, '/');
};
