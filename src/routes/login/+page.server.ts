import { fail, redirect } from '@sveltejs/kit';
import {
	isAdminAuthConfigured,
	safeAdminNextPath,
	setAdminSessionCookie,
	verifyAdminPassword
} from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.isAdmin) {
		throw redirect(303, safeAdminNextPath(url.searchParams.get('next')));
	}
	return {
		next: safeAdminNextPath(url.searchParams.get('next'))
	};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		if (!isAdminAuthConfigured()) {
			return fail(503, {
				error: 'Admin login is disabled until ADMIN_PASSWORD is configured.',
				next: '/admin'
			});
		}
		const data = await request.formData();
		const password = String(data.get('password') ?? '');
		const next = safeAdminNextPath(String(data.get('next') ?? '/admin'));

		if (!verifyAdminPassword(password)) {
			return fail(401, { error: 'Wrong admin password.', next });
		}

		setAdminSessionCookie(cookies);
		throw redirect(303, next);
	}
};
