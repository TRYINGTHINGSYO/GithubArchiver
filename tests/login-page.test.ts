import { afterEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from '../src/routes/login/+page.server';

function loadEvent(callbackUrl: string, locals: { user?: unknown; isAdmin?: boolean } = {}) {
	const url = new URL('https://archive.example/login');
	url.searchParams.set('callbackUrl', callbackUrl);
	return {
		locals: { user: null, isAdmin: false, ...locals },
		url
	} as Parameters<typeof load>[0];
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('login page fallback', () => {
	it('shows password login when GitHub OAuth is unavailable', () => {
		vi.stubEnv('AUTH_SECRET', 'secret');
		vi.stubEnv('AUTH_GITHUB_ID', '');
		vi.stubEnv('AUTH_GITHUB_SECRET', '');

		expect(load(loadEvent('/admin'))).toEqual({
			next: '/admin',
			authConfigured: false
		});
	});

	it('preserves a safe public callback when auth is unavailable', () => {
		vi.stubEnv('AUTH_SECRET', 'secret');
		vi.stubEnv('AUTH_GITHUB_ID', '');
		vi.stubEnv('AUTH_GITHUB_SECRET', '');

		expect(load(loadEvent('/repo/acme/widget?tab=activity'))).toEqual({
			next: '/repo/acme/widget?tab=activity',
			authConfigured: false
		});
	});

	it('keeps the password form available when GitHub OAuth is configured', () => {
		vi.stubEnv('AUTH_SECRET', 'secret');
		vi.stubEnv('AUTH_GITHUB_ID', 'client');
		vi.stubEnv('AUTH_GITHUB_SECRET', 'provider-secret');

		expect(load(loadEvent('/account/notifications'))).toEqual({
			next: '/account/notifications',
			authConfigured: true
		});
	});
});

describe('admin password action', () => {
	it('rejects the wrong password', async () => {
		vi.stubEnv('ADMIN_PASSWORD', 'correct-horse');
		const cookies = { set: vi.fn() };
		const request = {
			formData: async () => {
				const data = new FormData();
				data.set('password', 'nope');
				data.set('next', '/admin');
				return data;
			}
		};

		const result = await actions.default!({
			request,
			cookies
		} as Parameters<typeof actions.default>[0]);

		expect(result).toMatchObject({ status: 401, data: { error: 'Wrong admin password.' } });
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('sets the admin cookie and redirects on success', async () => {
		vi.stubEnv('ADMIN_PASSWORD', 'correct-horse');
		const cookies = { set: vi.fn() };
		const request = {
			formData: async () => {
				const data = new FormData();
				data.set('password', 'correct-horse');
				data.set('next', '/admin/jobs');
				return data;
			}
		};

		await expect(
			actions.default!({
				request,
				cookies
			} as Parameters<typeof actions.default>[0])
		).rejects.toMatchObject({
			status: 303,
			location: '/admin/jobs'
		});
		expect(cookies.set).toHaveBeenCalledWith(
			'gha_admin',
			expect.stringMatching(/^admin:\d+\.[a-f0-9]+$/),
			expect.objectContaining({ httpOnly: true, path: '/' })
		);
	});
});
