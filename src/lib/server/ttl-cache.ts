/**
 * Tiny process-local TTL cache for hot read-path aggregates.
 * Keeps navigation from re-scanning SQLite on every click/hover.
 */

interface CacheEntry<T> {
	expiresAt: number;
	storedAt: number;
	ttlMs: number;
	value: T;
}

interface KeyCounters {
	hits: number;
	misses: number;
}

export interface CacheGroupStats {
	label: string;
	hits: number;
	misses: number;
	/** hits / (hits + misses), 0–100 */
	hitRatePercent: number;
	/** misses / (hits + misses), 0–100 */
	missRatePercent: number;
	/** Mean age of currently live entries in this group (seconds). */
	averageTtlAgeSeconds: number | null;
	liveEntries: number;
	lookups: number;
}

export interface TtlCacheStats {
	groups: CacheGroupStats[];
	total: CacheGroupStats;
	processUptimeSeconds: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const counters = new Map<string, KeyCounters>();
const processStartedAt = Date.now();

/** Logical groups for the admin panel (prefix match on cache key). */
const GROUPS: Array<{ id: string; label: string; prefixes: string[] }> = [
	{
		id: 'homepage',
		label: 'Homepage',
		prefixes: ['data-readiness', 'enrichment-ops-snapshot', 'missing-gharchive-hours']
	},
	{
		id: 'cluster',
		label: 'Cluster',
		prefixes: ['cluster-analytics']
	},
	{
		id: 'activity',
		label: 'Activity bar',
		prefixes: ['daemon-activity']
	}
];

function keyPrefix(key: string): string {
	const colon = key.indexOf(':');
	return colon === -1 ? key : key.slice(0, colon);
}

function groupForKey(key: string): string {
	const prefix = keyPrefix(key);
	for (const group of GROUPS) {
		if (group.prefixes.includes(prefix)) return group.id;
	}
	return 'other';
}

function bump(key: string, kind: 'hits' | 'misses'): void {
	const groupId = groupForKey(key);
	const current = counters.get(groupId) ?? { hits: 0, misses: 0 };
	current[kind] += 1;
	counters.set(groupId, current);
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

function toGroupStats(
	label: string,
	hits: number,
	misses: number,
	agesMs: number[]
): CacheGroupStats {
	const lookups = hits + misses;
	const hitRatePercent = lookups > 0 ? round1((hits / lookups) * 100) : 0;
	const missRatePercent = lookups > 0 ? round1((misses / lookups) * 100) : 0;
	const averageTtlAgeSeconds =
		agesMs.length > 0
			? round1(agesMs.reduce((a, b) => a + b, 0) / agesMs.length / 1000)
			: null;
	return {
		label,
		hits,
		misses,
		hitRatePercent,
		missRatePercent,
		averageTtlAgeSeconds,
		liveEntries: agesMs.length,
		lookups
	};
}

export function cached<T>(key: string, ttlMs: number, compute: () => T): T {
	const now = Date.now();
	const hit = cache.get(key) as CacheEntry<T> | undefined;
	if (hit && hit.expiresAt > now) {
		bump(key, 'hits');
		return hit.value;
	}
	bump(key, 'misses');
	const value = compute();
	cache.set(key, { value, expiresAt: now + ttlMs, storedAt: now, ttlMs });
	return value;
}

export function getTtlCacheStats(): TtlCacheStats {
	const now = Date.now();
	const agesByGroup = new Map<string, number[]>();

	for (const [key, entry] of cache.entries()) {
		if (entry.expiresAt <= now) continue;
		const groupId = groupForKey(key);
		const list = agesByGroup.get(groupId) ?? [];
		list.push(now - entry.storedAt);
		agesByGroup.set(groupId, list);
	}

	const groups: CacheGroupStats[] = GROUPS.map((group) => {
		const c = counters.get(group.id) ?? { hits: 0, misses: 0 };
		return toGroupStats(group.label, c.hits, c.misses, agesByGroup.get(group.id) ?? []);
	});

	// Surface any ungrouped keys if they appear later.
	const known = new Set(GROUPS.map((g) => g.id));
	for (const [groupId, c] of counters.entries()) {
		if (known.has(groupId)) continue;
		groups.push(toGroupStats(groupId, c.hits, c.misses, agesByGroup.get(groupId) ?? []));
	}

	const totalHits = groups.reduce((n, g) => n + g.hits, 0);
	const totalMisses = groups.reduce((n, g) => n + g.misses, 0);
	const allAges = [...agesByGroup.values()].flat();

	return {
		groups,
		total: toGroupStats('All caches', totalHits, totalMisses, allAges),
		processUptimeSeconds: Math.round((now - processStartedAt) / 1000)
	};
}

export function clearTtlCacheForTests(): void {
	cache.clear();
	counters.clear();
}
