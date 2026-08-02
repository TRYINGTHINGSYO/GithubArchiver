import { error, redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { handle as authenticationHandle } from './auth';
import { ensureBackgroundWorker } from '$lib/server/background-daemon';
import { accessRequirement, requiresSameOrigin } from '$lib/server/auth/access';
import { assertSameOrigin, requireAdmin, requireUser } from '$lib/server/auth/guards';
import { isAuthConfigured, shouldResolveAuthSession } from '$lib/server/auth/runtime';
import type { AuthUser } from '$lib/server/auth/types';
import { resolveAnonymousCollectionOwner } from '$lib/server/collection-owner';
import { ensureDatabaseReady } from '$lib/server/db/connection';

/** Common bot/scanner paths — return quiet 404 without SSR. */
const PROBE_RE =
	/^\/(?:contact(?:-us|o)?|contactus|about(?:-us)?|support|help|team|pricing|legal|privacy|terms|company|kontakt|contatti|contato|reach-us|get-in-touch|nosotros|sobre-nosotros|impressum|wp-admin|wp-login|\.env|phpmyadmin)(?:\/|$)/i;

let workerBooted = false;

const applicationHandle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	if (!workerBooted) {
		workerBooted = true;
		ensureDatabaseReady();
		// Daemon start is delayed inside ensureBackgroundWorker so Railway's
		// /api/health check is not racing ingest for SQLite.
		ensureBackgroundWorker();
	}

	if (PROBE_RE.test(path) || /^\/(?:en|es)\//i.test(path)) {
		return new Response(null, {
			status: 404,
			headers: { 'Cache-Control': 'public, max-age=86400' }
		});
	}

	if ((path === '/auth/signin' || path.startsWith('/auth/signin/')) && !isAuthConfigured()) {
		const callbackUrl = event.url.searchParams.get('callbackUrl');
		const loginUrl = callbackUrl
			? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
			: '/login';
		throw redirect(303, loginUrl);
	}

	return resolve(event);
};

const authorizationHandle: Handle = async ({ event, resolve }) => {
	event.locals.session = null;
	event.locals.user = null;
	event.locals.isAdmin = false;
	event.locals.collectionOwner = resolveAnonymousCollectionOwner(event.cookies);

	const requirement = accessRequirement(event.url.pathname, event.request.method);
	const authConfigured = isAuthConfigured();
	if (
		shouldResolveAuthSession(
			event.url.pathname,
			requirement,
			event.request.headers.get('cookie')
		)
	) {
		const session = await event.locals.auth();
		event.locals.session = session;
		event.locals.user = (session?.user as AuthUser | undefined) ?? null;
		event.locals.isAdmin = event.locals.user?.role === 'admin';
	}

	if (requirement !== null && !authConfigured) {
		if (event.url.pathname.startsWith('/api/')) {
			throw error(503, 'Authentication is not configured');
		}
		throw redirect(
			303,
			`/login?callbackUrl=${encodeURIComponent(`${event.url.pathname}${event.url.search}`)}`
		);
	}

	if (requirement === 'admin') requireAdmin(event);
	else if (requirement === 'user') requireUser(event);

	if (requiresSameOrigin(event.url.pathname, event.request.method)) {
		assertSameOrigin(event);
	}

	return resolve(event);
};

export const handle: Handle = sequence(applicationHandle, authenticationHandle, authorizationHandle);
