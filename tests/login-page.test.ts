import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from '../src/routes/login/+page.server';

function loadEvent(callbackUrl: string) {
	const url = new URL('https://archive.example/login');
	url.searchParams.set('callbackUrl', callbackUrl);
	return {
		locals: { user: null },
		url
	} as Parameters<typeof load>[0];
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('login page fallback', () => {
	it('returns protected callbacks to the public homepage when auth is unavailable', async () => {
		vi.stubEnv('AUTH_SECRET', 'secret');
		vi.stubEnv('AUTH_GITHUB_ID', '');
		vi.stubEnv('AUTH_GITHUB_SECRET', '');

		expect(load(loadEvent('/account/notifications'))).toEqual({ returnPath: '/' });
	});

	it('preserves a safe public callback when auth is unavailable', async () => {
		vi.stubEnv('AUTH_SECRET', 'secret');
		vi.stubEnv('AUTH_GITHUB_ID', '');
		vi.stubEnv('AUTH_GITHUB_SECRET', '');

		expect(load(loadEvent('/repo/acme/widget?tab=activity'))).toEqual({
			returnPath: '/repo/acme/widget?tab=activity'
		});
	});

	it('continues to Auth.js only when all GitHub OAuth settings exist', () => {
		vi.stubEnv('AUTH_SECRET', 'secret');
		vi.stubEnv('AUTH_GITHUB_ID', 'client');
		vi.stubEnv('AUTH_GITHUB_SECRET', 'provider-secret');

		expect(() => load(loadEvent('/account/notifications'))).toThrow();
	});
});
