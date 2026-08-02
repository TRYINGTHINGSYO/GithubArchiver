import { redirect } from '@sveltejs/kit';
import { safeAuthCallbackPath } from '$lib/server/auth';
import { accessRequirement } from '$lib/server/auth/access';
import { isAuthConfigured } from '$lib/server/auth/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const callbackUrl = safeAuthCallbackPath(
		url.searchParams.get('next') ?? url.searchParams.get('callbackUrl'),
		locals.user?.role === 'admin' ? '/admin' : '/'
	);
	if (locals.user) throw redirect(303, callbackUrl);
	if (isAuthConfigured()) {
		throw redirect(303, `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
	}

	const callbackPathname = new URL(callbackUrl, url.origin).pathname;
	const returnPath =
		accessRequirement(callbackPathname) === null &&
		callbackPathname !== '/login' &&
		!callbackPathname.startsWith('/auth/')
			? callbackUrl
			: '/';

	return { returnPath };
};
