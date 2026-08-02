import { redirect } from '@sveltejs/kit';
import { safeAuthCallbackPath } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const callbackUrl = safeAuthCallbackPath(
		url.searchParams.get('next') ?? url.searchParams.get('callbackUrl'),
		locals.user?.role === 'admin' ? '/admin' : '/'
	);
	if (locals.user) throw redirect(303, callbackUrl);
	throw redirect(303, `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
};
