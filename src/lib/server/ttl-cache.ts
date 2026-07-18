/**
 * Tiny process-local TTL cache for hot read-path aggregates.
 * Keeps navigation from re-scanning SQLite on every click/hover.
 */

interface CacheEntry<T> {
	expiresAt: number;
	value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function cached<T>(key: string, ttlMs: number, compute: () => T): T {
	const now = Date.now();
	const hit = cache.get(key) as CacheEntry<T> | undefined;
	if (hit && hit.expiresAt > now) return hit.value;
	const value = compute();
	cache.set(key, { value, expiresAt: now + ttlMs });
	return value;
}

export function clearTtlCacheForTests(): void {
	cache.clear();
}
