import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createAdminSessionValue,
	PASSWORD_ADMIN_USER,
	verifyAdminPassword,
	verifyAdminSessionValue
} from '../src/lib/server/auth/admin-password';

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('admin password sessions', () => {
	it('verifies the configured password', () => {
		vi.stubEnv('ADMIN_PASSWORD', 'ops-secret');
		expect(verifyAdminPassword('ops-secret')).toBe(true);
		expect(verifyAdminPassword('wrong')).toBe(false);
	});

	it('defaults to GitHub when ADMIN_PASSWORD is unset', () => {
		vi.stubEnv('ADMIN_PASSWORD', '');
		expect(verifyAdminPassword('GitHub')).toBe(true);
	});

	it('round-trips signed session values', () => {
		vi.stubEnv('ADMIN_PASSWORD', 'ops-secret');
		vi.stubEnv('ADMIN_SESSION_SECRET', 'session-secret');
		const value = createAdminSessionValue();
		expect(verifyAdminSessionValue(value)).toBe(true);
		expect(verifyAdminSessionValue(`${value}x`)).toBe(false);
		expect(PASSWORD_ADMIN_USER.role).toBe('admin');
	});
});
