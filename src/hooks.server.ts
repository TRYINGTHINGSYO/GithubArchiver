import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { handle as authenticationHandle } from './auth';
import { ensureBackgroundWorker } from '$lib/server/background-daemon';
import { accessRequirement, requiresSameOrigin } from '$lib/server/auth/access';
import { assertSameOrigin, requireAdmin, requireUser } from '$lib/server/auth/guards';
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

	return resolve(event);
};

const authorizationHandle: Handle = async ({ event, resolve }) => {
	const session = await event.locals.auth();
	event.locals.session = session;
	event.locals.user = (session?.user as AuthUser | undefined) ?? null;
	event.locals.isAdmin = event.locals.user?.role === 'admin';
	event.locals.collectionOwner = resolveAnonymousCollectionOwner(event.cookies);

	const requirement = accessRequirement(event.url.pathname, event.request.method);
	if (requirement === 'admin') requireAdmin(event);
	else if (requirement === 'user') requireUser(event);

	if (requiresSameOrigin(event.url.pathname, event.request.method)) {
		assertSameOrigin(event);
	}

	return resolve(event);
};

export const handle: Handle = sequence(applicationHandle, authenticationHandle, authorizationHandle);
