import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createAdminSessionValue,
	isAdminAuthConfigured,
	safeAdminNextPath,
	verifyAdminPassword,
	verifyAdminSessionValue
} from '$lib/server/auth';

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('admin authentication hardening', () => {
	it('fails closed in production when ADMIN_PASSWORD is missing', () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('ADMIN_PASSWORD', '');
		vi.stubEnv('ADMIN_SESSION_SECRET', '');

		expect(isAdminAuthConfigured()).toBe(false);
		expect(verifyAdminPassword('GitHub')).toBe(false);
		expect(verifyAdminSessionValue('admin:1.invalid')).toBe(false);
		expect(() => createAdminSessionValue()).toThrow(/ADMIN_PASSWORD/);
	});

	it('creates and verifies sessions when production credentials are configured', () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('ADMIN_PASSWORD', 'correct horse battery staple');
		vi.stubEnv('ADMIN_SESSION_SECRET', 'independent session signing secret');

		expect(isAdminAuthConfigured()).toBe(true);
		expect(verifyAdminPassword('correct horse battery staple')).toBe(true);
		expect(verifyAdminPassword('GitHub')).toBe(false);
		const session = createAdminSessionValue();
		expect(verifyAdminSessionValue(session)).toBe(true);
	});

	it('keeps the documented fallback limited to local development', () => {
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('ADMIN_PASSWORD', '');
		vi.stubEnv('ADMIN_SESSION_SECRET', '');

		expect(isAdminAuthConfigured()).toBe(true);
		expect(verifyAdminPassword('GitHub')).toBe(true);
	});

	it('only accepts same-origin paths for post-login redirects', () => {
		expect(safeAdminNextPath('/admin/storage?tab=cleanup')).toBe(
			'/admin/storage?tab=cleanup'
		);
		expect(safeAdminNextPath('//evil.example')).toBe('/admin');
		expect(safeAdminNextPath('/\\evil.example')).toBe('/admin');
		expect(safeAdminNextPath('https://evil.example')).toBe('/admin');
		expect(safeAdminNextPath('/admin\nLocation: https://evil.example')).toBe('/admin');
	});
});
