import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { accessRequirement, requiresSameOrigin } from '$lib/server/auth/access';
import { assertSameOrigin, requireAdmin, requireUser } from '$lib/server/auth/guards';
import {
	hasAuthSessionCookie,
	isAuthConfigured,
	shouldResolveAuthSession
} from '$lib/server/auth/runtime';
import type { AuthUser } from '$lib/server/auth/types';

function eventFor(path: string, options: { method?: string; origin?: string; user?: AuthUser | null } = {}) {
	const url = new URL(path, 'https://archive.example');
	const headers = new Headers();
	if (options.origin) headers.set('origin', options.origin);
	const user = options.user ?? null;
	return {
		url,
		request: new Request(url, { method: options.method ?? 'GET', headers }),
		locals: { user, session: user ? { user, expires: new Date(Date.now() + 60_000).toISOString() } : null }
	} as unknown as RequestEvent;
}

const regularUser: AuthUser = {
	id: 'user-1',
	name: 'User',
	email: 'user@example.com',
	emailVerified: null,
	image: null,
	role: 'user',
	githubLogin: 'user'
};

const adminUser: AuthUser = { ...regularUser, id: 'admin-1', role: 'admin', githubLogin: 'admin' };

describe('route access policy', () => {
	it('protects admin and mutation surfaces', () => {
		expect(accessRequirement('/admin')).toBe('admin');
		expect(accessRequirement('/api/admin/workers')).toBe('admin');
		expect(accessRequirement('/api/repo/acme/widget/actions', 'POST')).toBe('admin');
		expect(accessRequirement('/api/repo/acme/widget/export', 'POST')).toBe('admin');
		expect(accessRequirement('/api/repo/save', 'POST')).toBe('admin');
		expect(accessRequirement('/api/repos/1/archive-story/regenerate', 'POST')).toBe('admin');
		expect(accessRequirement('/api/discovery/emerging/topic', 'POST')).toBe('admin');
		expect(accessRequirement('/api/discovery/emerging/topic', 'GET')).toBeNull();
		expect(accessRequirement('/api/export/names')).toBe('admin');
		expect(accessRequirement('/api/export/bulk/12/download')).toBe('admin');
	});

	it('requires a user for personal and snapshot routes while leaving public reads public', () => {
		expect(accessRequirement('/api/me/saved-repos')).toBe('user');
		expect(accessRequirement('/api/snapshots/12')).toBe('user');
		expect(accessRequirement('/api/repos')).toBeNull();
		expect(accessRequirement('/repo/acme/widget')).toBeNull();
	});

	it('requires same-origin checks only for protected mutations', () => {
		expect(requiresSameOrigin('/api/admin/workers', 'POST')).toBe(true);
		expect(requiresSameOrigin('/api/me/saved-repos', 'DELETE')).toBe(true);
		expect(requiresSameOrigin('/api/admin/status', 'GET')).toBe(false);
		expect(requiresSameOrigin('/api/repos', 'POST')).toBe(false);
	});
});

describe('auth runtime policy', () => {
	it('never resolves Auth.js for the health check', () => {
		expect(shouldResolveAuthSession('/api/health', null, null, 'secret')).toBe(false);
		expect(
			shouldResolveAuthSession(
				'/api/health/',
				null,
				'__Secure-authjs.session-token=session',
				'secret'
			)
		).toBe(false);
	});

	it('resolves sessions only when configured and useful', () => {
		expect(shouldResolveAuthSession('/api/repos', null, null, 'secret')).toBe(false);
		expect(shouldResolveAuthSession('/admin', 'admin', null, 'secret')).toBe(true);
		expect(
			shouldResolveAuthSession(
				'/repo/acme/widget',
				null,
				'__Secure-authjs.session-token.0=session',
				'secret'
			)
		).toBe(true);
		expect(shouldResolveAuthSession('/admin', 'admin', null, '')).toBe(false);
	});

	it('recognizes regular, secure, and chunked Auth.js session cookies', () => {
		expect(hasAuthSessionCookie('authjs.session-token=session')).toBe(true);
		expect(hasAuthSessionCookie('theme=dark; __Secure-authjs.session-token=session')).toBe(true);
		expect(hasAuthSessionCookie('__Host-authjs.session-token.1=session')).toBe(true);
		expect(hasAuthSessionCookie('theme=dark')).toBe(false);
		expect(isAuthConfigured('   ')).toBe(false);
		expect(isAuthConfigured('secret')).toBe(true);
	});
});

describe('authorization guards', () => {
	it('returns authenticated users and admins', () => {
		expect(requireUser(eventFor('/api/me/saved-repos', { user: regularUser }))).toBe(regularUser);
		expect(requireAdmin(eventFor('/admin', { user: adminUser }))).toBe(adminUser);
	});

	it('rejects anonymous API calls and non-admin users', () => {
		expect(() => requireUser(eventFor('/api/me/saved-repos'))).toThrow();
		expect(() => requireAdmin(eventFor('/api/admin/workers', { user: regularUser }))).toThrow();
	});

	it('redirects anonymous page requests to Auth.js with a safe return path', () => {
		try {
			requireUser(eventFor('/admin/jobs?type=archive'));
			throw new Error('expected redirect');
		} catch (err) {
			expect(err).toMatchObject({
				status: 303,
				location: '/auth/signin?callbackUrl=%2Fadmin%2Fjobs%3Ftype%3Darchive'
			});
		}
	});

	it('accepts only an exact same-origin Origin header', () => {
		expect(() =>
			assertSameOrigin(
				eventFor('/api/admin/workers', {
					method: 'POST',
					origin: 'https://archive.example',
					user: adminUser
				})
			)
		).not.toThrow();
		expect(() =>
			assertSameOrigin(
				eventFor('/api/admin/workers', {
					method: 'POST',
					origin: 'https://evil.example',
					user: adminUser
				})
			)
		).toThrow();
	});
});
