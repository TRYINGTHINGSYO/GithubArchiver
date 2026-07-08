import type { Handle } from '@sveltejs/kit';
import { ensureBackgroundWorker } from '$lib/server/background-daemon';
import { ADMIN_COOKIE, verifyAdminSessionValue } from '$lib/server/auth';

/** Common bot/scanner paths — return quiet 404 without SSR. */
const PROBE_RE =
	/^\/(?:contact(?:-us|o)?|contactus|about(?:-us)?|support|help|team|pricing|legal|privacy|terms|company|kontakt|contatti|contato|reach-us|get-in-touch|nosotros|sobre-nosotros|impressum|wp-admin|wp-login|\.env|phpmyadmin)(?:\/|$)/i;

let workerBooted = false;

export const handle: Handle = async ({ event, resolve }) => {
	if (!workerBooted) {
		workerBooted = true;
		ensureBackgroundWorker();
	}

	const path = event.url.pathname;
	event.locals.isAdmin = verifyAdminSessionValue(event.cookies.get(ADMIN_COOKIE));

	if (PROBE_RE.test(path) || /^\/(?:en|es)\//i.test(path)) {
		return new Response(null, {
			status: 404,
			headers: { 'Cache-Control': 'public, max-age=86400' }
		});
	}

	if (!event.locals.isAdmin && (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/'))) {
		if (path.startsWith('/api/')) {
			return Response.json({ ok: false, error: 'Admin login required.' }, { status: 401 });
		}
		const loginUrl = new URL('/login', event.url);
		loginUrl.searchParams.set('next', `${event.url.pathname}${event.url.search}`);
		return Response.redirect(loginUrl, 303);
	}

	return resolve(event);
};
