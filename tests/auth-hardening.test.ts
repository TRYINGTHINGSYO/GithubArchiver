import { describe, expect, it } from 'vitest';
import { safeAuthCallbackPath } from '$lib/server/auth';

describe('Auth.js callback hardening', () => {
	it('only accepts same-origin callback paths', () => {
		expect(safeAuthCallbackPath('/admin/storage?tab=cleanup', '/admin')).toBe(
			'/admin/storage?tab=cleanup'
		);
		expect(safeAuthCallbackPath('//evil.example', '/admin')).toBe('/admin');
		expect(safeAuthCallbackPath('/\\evil.example', '/admin')).toBe('/admin');
		expect(safeAuthCallbackPath('https://evil.example', '/admin')).toBe('/admin');
		expect(safeAuthCallbackPath('/admin\nLocation: https://evil.example', '/admin')).toBe('/admin');
	});
});
