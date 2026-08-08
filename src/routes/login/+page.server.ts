import { fail, redirect } from '@sveltejs/kit';
import { safeAuthCallbackPath } from '$lib/server/auth';
import {
	setAdminSessionCookie,
	verifyAdminPassword
} from '$lib/server/auth/admin-password';
import { isAuthConfigured } from '$lib/server/auth/runtime';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeAuthCallbackPath(
		url.searchParams.get('next') ?? url.searchParams.get('callbackUrl'),
		locals.isAdmin || locals.user?.role === 'admin' ? '/admin' : '/'
	);
	if (locals.isAdmin || locals.user) throw redirect(303, next);

	return {
		next,
		authConfigured: isAuthConfigured()
	};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const password = String(data.get('password') ?? '');
		const next = safeAuthCallbackPath(String(data.get('next') ?? '/admin'), '/admin');

		if (!verifyAdminPassword(password)) {
			return fail(401, { error: 'Wrong admin password.', next });
		}

		setAdminSessionCookie(cookies);
		throw redirect(303, next);
	}
};
