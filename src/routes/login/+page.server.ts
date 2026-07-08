import { fail, redirect } from '@sveltejs/kit';
import { setAdminSessionCookie, verifyAdminPassword } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

function safeNext(value: string | null): string {
	if (!value || !value.startsWith('/') || value.startsWith('//')) return '/admin';
	return value;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.isAdmin) {
		throw redirect(303, safeNext(url.searchParams.get('next')));
	}
	return {
		next: safeNext(url.searchParams.get('next'))
	};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const password = String(data.get('password') ?? '');
		const next = safeNext(String(data.get('next') ?? '/admin'));

		if (!verifyAdminPassword(password)) {
			return fail(401, { error: 'Wrong admin password.', next });
		}

		setAdminSessionCookie(cookies);
		throw redirect(303, next);
	}
};
