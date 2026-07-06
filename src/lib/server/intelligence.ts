import { getDb, parseTopics, type RepoRow } from '$lib/server/db';

const FIVE_MINUTES = 5 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;

interface CacheEntry<T> {
	expiresAt: number;
	value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string, ttlMs: number, compute: () => T): T {
	const now = Date.now();
	const hit = cache.get(key) as CacheEntry<T> | undefined;
	if (hit && hit.expiresAt > now) return hit.value;
	const value = compute();
	cache.set(key, { value, expiresAt: now + ttlMs });
	return value;
}

function daysSince(iso: string | null | undefined): number | null {
	if (!iso) return null;
	return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function momentTag(repo: Pick<RepoRow, 'first_seen_at' | 'pushed_at' | 'last_checked_at' | 'created_at'>): string {
	const firstSeenDays = daysSince(repo.first_seen_at);
	const pushedDays = daysSince(repo.pushed_at);
	const checkedDays = daysSince(repo.last_checked_at);
	const createdDays = daysSince(repo.created_at);

	if (firstSeenDays !== null && firstSeenDays <= 1) return 'just discovered';
	if (pushedDays !== null && pushedDays <= 14 && createdDays !== null && createdDays > 365) return 'revived';
	if (pushedDays !== null && pushedDays <= 45) return 'recently active';
	if (pushedDays !== null && pushedDays > 730 && checkedDays !== null && checkedDays <= 30) return 'abandoned likely';
	if (pushedDays !== null && pushedDays > 365) return 'stale';
	return 'steady';
}

export function velocityIndicator(repo: Pick<RepoRow, 'stars' | 'forks' | 'watchers' | 'pushed_at'> & { stars_delta?: number | null }): 'up' | 'down' | 'flat' {
	if ((repo.stars_delta ?? 0) > 0) return 'up';
	const pushedDays = daysSince(repo.pushed_at);
	if (pushedDays !== null && pushedDays <= 14) return 'up';
	if (pushedDays !== null && pushedDays > 365) return 'down';
	return 'flat';
}

export interface TrendSnapshot {
	fastestGrowingStars: {
		id: number;
		owner: string;
		name: string;
		full_name: string;
		language: string | null;
		stars_delta: number;
	}[];
	newLanguagesToday: { language: string; count: number }[];
	burstRepos: {
		id: number;
		owner: string;
		name: string;
		full_name: string;
		recent_events: number;
	}[];
	trendingTopics: { topic: string; count: number }[];
	generatedAt: string;
}

export function getTrendSnapshot(): TrendSnapshot {
	return cached('trend-snapshot', FIVE_MINUTES, () => {
		const db = getDb();
		const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

		const fastestGrowingStars = db
			.prepare(
				`SELECT r.id, r.owner, r.name, r.full_name, r.language,
				        (MAX(m.stars) - MIN(m.stars)) as stars_delta
				 FROM repo_metrics_snapshots m
				 JOIN repos r ON r.id = m.repo_id
				 WHERE m.captured_at >= ?
				 GROUP BY r.id
				 HAVING stars_delta > 0
				 ORDER BY stars_delta DESC
				 LIMIT 10`
			)
			.all(since24h) as TrendSnapshot['fastestGrowingStars'];

		const newLanguagesToday = db
			.prepare(
				`SELECT COALESCE(language, 'Unknown') as language, COUNT(*) as count
				 FROM repos
				 WHERE first_seen_at >= ?
				 GROUP BY COALESCE(language, 'Unknown')
				 ORDER BY count DESC
				 LIMIT 12`
			)
			.all(since24h) as TrendSnapshot['newLanguagesToday'];

		const burstRepos = db
			.prepare(
				`SELECT r.id, r.owner, r.name, r.full_name, COUNT(e.id) as recent_events
				 FROM repository_events e
				 JOIN repos r ON r.id = e.repo_id
				 WHERE e.event_time >= ? AND e.event_time GLOB '????-??-??T*'
				 GROUP BY r.id
				 HAVING recent_events >= 2
				 ORDER BY recent_events DESC, MAX(e.event_time) DESC
				 LIMIT 10`
			)
			.all(since24h) as TrendSnapshot['burstRepos'];

		const topicRows = db
			.prepare(
				`SELECT topics
				 FROM repos
				 WHERE first_seen_at >= ? AND topics IS NOT NULL AND topics != ''
				 LIMIT 1000`
			)
			.all(since24h) as { topics: string | null }[];
		const topicCounts = new Map<string, number>();
		for (const row of topicRows) {
			for (const topic of parseTopics(row.topics)) {
				topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
			}
		}
		const trendingTopics = [...topicCounts.entries()]
			.map(([topic, count]) => ({ topic, count }))
			.sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
			.slice(0, 16);

		return {
			fastestGrowingStars,
			newLanguagesToday,
			burstRepos,
			trendingTopics,
			generatedAt: new Date().toISOString()
		};
	});
}

export function getLiveOverview() {
	return cached('live-overview', TEN_MINUTES, () => {
		const db = getDb();
		const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		return {
			discovered24h: (db.prepare('SELECT COUNT(*) as c FROM repos WHERE first_seen_at >= ?').get(since24h) as { c: number }).c,
			archived24h: (db.prepare('SELECT COUNT(*) as c FROM archive_snapshots WHERE archived_at >= ?').get(since24h) as { c: number }).c,
			releases24h: (db.prepare('SELECT COUNT(*) as c FROM releases WHERE first_seen_at >= ?').get(since24h) as { c: number }).c,
			updatedAt: new Date().toISOString()
		};
	});
}
