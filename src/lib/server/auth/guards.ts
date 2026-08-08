import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { isAuthConfigured } from './runtime';
import type { AuthUser } from './types';

function returnTo(event: RequestEvent): string {
	return `${event.url.pathname}${event.url.search}`;
}

function signInPath(event: RequestEvent): string {
	const callback = encodeURIComponent(returnTo(event));
	return isAuthConfigured()
		? `/auth/signin?callbackUrl=${callback}`
		: `/login?callbackUrl=${callback}`;
}

export function requireUser(event: RequestEvent): AuthUser {
	if (!event.locals.session || !event.locals.user) {
		if (event.url.pathname.startsWith('/api/')) {
			throw error(401, 'Unauthorized');
		}
		throw redirect(303, signInPath(event));
	}
	return event.locals.user;
}

export function requireAdmin(event: RequestEvent): AuthUser {
	const user = requireUser(event);
	if (user.role !== 'admin') {
		throw error(
			403,
			event.url.pathname.startsWith('/api/') ? 'Admin access required' : 'Access denied'
		);
	}
	return user;
}

export function assertSameOrigin(event: RequestEvent): void {
	const origin = event.request.headers.get('origin');
	if (!origin) throw error(403, 'Origin header required');

	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		throw error(403, 'Invalid request origin');
	}

	if (parsed.origin !== event.url.origin) {
		throw error(403, 'Cross-origin request rejected');
	}
}
