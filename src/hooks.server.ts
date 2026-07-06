import type { Handle } from '@sveltejs/kit';

/** Common bot/scanner paths — return quiet 404 without SSR. */
const PROBE_RE =
	/^\/(?:contact(?:-us|o)?|contactus|about(?:-us)?|support|help|team|pricing|legal|privacy|terms|company|kontakt|contatti|contato|reach-us|get-in-touch|nosotros|sobre-nosotros|impressum|wp-admin|wp-login|\.env|phpmyadmin)(?:\/|$)/i;

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	if (PROBE_RE.test(path) || /^\/(?:en|es)\//i.test(path)) {
		return new Response(null, {
			status: 404,
			headers: { 'Cache-Control': 'public, max-age=86400' }
		});
	}

	return resolve(event);
};
