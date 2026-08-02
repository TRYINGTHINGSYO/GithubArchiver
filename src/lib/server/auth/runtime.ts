import type { AccessRequirement } from './access';

const AUTH_SESSION_COOKIE_RE =
	/(?:^|;\s*)(?:(?:__Secure-|__Host-)?authjs\.session-token)(?:\.\d+)?=/;

export function isAuthConfigured(secret = process.env.AUTH_SECRET): boolean {
	return Boolean(secret?.trim());
}

export function hasAuthSessionCookie(cookieHeader: string | null): boolean {
	return AUTH_SESSION_COOKIE_RE.test(cookieHeader ?? '');
}

export function shouldResolveAuthSession(
	pathname: string,
	requirement: AccessRequirement,
	cookieHeader: string | null,
	secret = process.env.AUTH_SECRET
): boolean {
	if (pathname === '/api/health' || pathname === '/api/health/') return false;
	return isAuthConfigured(secret) && (requirement !== null || hasAuthSessionCookie(cookieHeader));
}
