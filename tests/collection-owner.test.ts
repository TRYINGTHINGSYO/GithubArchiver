import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import {
	ANONYMOUS_OWNER_COOKIE,
	canonicalizeAnonymousOwnerKey,
	resolveAnonymousCollectionOwner
} from '$lib/server/collection-owner';

function cookieJar(value: string | undefined) {
	const set = vi.fn();
	const cookies = {
		get: vi.fn(() => value),
		set
	} as unknown as Cookies;
	return { cookies, set };
}

describe('anonymous collection ownership', () => {
	it('canonicalizes purpose-built anonymous UUIDs', () => {
		expect(canonicalizeAnonymousOwnerKey(' ANON:550E8400-E29B-41D4-A716-446655440000 ')).toBe(
			'anon:550e8400-e29b-41d4-a716-446655440000'
		);
	});

	it('reuses a stable opaque cookie without storing the raw cookie form', () => {
		const { cookies, set } = cookieJar('550E8400-E29B-41D4-A716-446655440000');
		const owner = resolveAnonymousCollectionOwner(cookies);
		expect(owner).toEqual({
			owner_type: 'anonymous',
			owner_key: 'anon:550e8400-e29b-41d4-a716-446655440000'
		});
		expect(set).not.toHaveBeenCalled();
	});

	it('rejects signed/session-like cookie values and replaces them with an opaque ID', () => {
		const rawToken = 's:raw-session-token.signature';
		const { cookies, set } = cookieJar(rawToken);
		const owner = resolveAnonymousCollectionOwner(cookies);

		expect(owner.owner_key).toMatch(/^anon:[0-9a-f-]{36}$/);
		expect(owner.owner_key).not.toContain(rawToken);
		expect(set).toHaveBeenCalledOnce();
		expect(set.mock.calls[0]?.[0]).toBe(ANONYMOUS_OWNER_COOKIE);
		expect(set.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/);
		expect(set.mock.calls[0]?.[2]).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
	});
});
