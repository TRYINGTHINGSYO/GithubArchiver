import { randomUUID } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

export const ANONYMOUS_OWNER_COOKIE = 'gha_anonymous_owner';
export const ANONYMOUS_OWNER_TYPE = 'anonymous' as const;

export interface CollectionOwner {
	owner_type: typeof ANONYMOUS_OWNER_TYPE;
	owner_key: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function anonymousIdFromValue(value: string): string {
	const normalized = value.trim().toLowerCase();
	const id = normalized.startsWith('anon:') ? normalized.slice(5) : normalized;
	if (!UUID_RE.test(id)) {
		throw new Error('Anonymous owner identifiers must be UUIDs.');
	}
	return id;
}

/** Convert a purpose-built anonymous ID into the only form stored in owner_key. */
export function canonicalizeAnonymousOwnerKey(value: string): string {
	return `anon:${anonymousIdFromValue(value)}`;
}

/** Canonicalize every owner before a collection lookup or write. */
export function canonicalizeCollectionOwner(owner: CollectionOwner): CollectionOwner {
	if (owner.owner_type !== ANONYMOUS_OWNER_TYPE) {
		throw new Error(`Unsupported collection owner type: ${String(owner.owner_type)}`);
	}
	return {
		owner_type: ANONYMOUS_OWNER_TYPE,
		owner_key: canonicalizeAnonymousOwnerKey(owner.owner_key)
	};
}

/**
 * Resolve a stable anonymous owner. The cookie holds only a purpose-built opaque
 * UUID; session tokens and signed cookie payloads are rejected and replaced.
 */
export function resolveAnonymousCollectionOwner(cookies: Cookies): CollectionOwner {
	const current = cookies.get(ANONYMOUS_OWNER_COOKIE);
	let id: string;
	try {
		// Cookie values must be the bare opaque ID, never an internal owner key,
		// session token, or signed payload.
		if (!current || current.includes(':') || current.includes('.')) throw new Error('invalid');
		id = anonymousIdFromValue(current);
	} catch {
		id = randomUUID();
		cookies.set(ANONYMOUS_OWNER_COOKIE, id, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			maxAge: 60 * 60 * 24 * 365
		});
	}

	return {
		owner_type: ANONYMOUS_OWNER_TYPE,
		owner_key: canonicalizeAnonymousOwnerKey(id)
	};
}
