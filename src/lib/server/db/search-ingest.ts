import { getDb } from './connection.js';
import type { SearchIngestStatRow } from './types.js';

export type SearchIngestStatus = 'running' | 'completed' | 'sharded' | 'failed';

export function startSearchIngestStat(opts: {
	hourKey: string;
	query: string;
	shardDepth: number;
	shardMinutes: number | null;
	source?: string;
}): number {
	const db = getDb();
	const now = new Date().toISOString();
	const result = db
		.prepare(
			`INSERT INTO search_ingest_stats
			 (hour_key, query, shard_depth, shard_minutes, source, status, started_at)
			 VALUES (?, ?, ?, ?, ?, 'running', ?)`
		)
		.run(
			opts.hourKey,
			opts.query,
			opts.shardDepth,
			opts.shardMinutes,
			opts.source ?? 'github_search',
			now
		);
	return Number(result.lastInsertRowid);
}

export function completeSearchIngestStat(
	id: number,
	patch: {
		status: 'completed' | 'sharded';
		totalCount?: number;
		incompleteResults?: boolean;
		pagesFetched?: number;
		found?: number;
		inserted?: number;
		skipped?: number;
	}
): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE search_ingest_stats SET
		   status = ?,
		   total_count = COALESCE(?, total_count),
		   incomplete_results = COALESCE(?, incomplete_results),
		   pages_fetched = COALESCE(?, pages_fetched),
		   found = COALESCE(?, found),
		   inserted = COALESCE(?, inserted),
		   skipped = COALESCE(?, skipped),
		   finished_at = ?
		 WHERE id = ?`
	).run(
		patch.status,
		patch.totalCount ?? null,
		patch.incompleteResults ? 1 : 0,
		patch.pagesFetched ?? null,
		patch.found ?? null,
		patch.inserted ?? null,
		patch.skipped ?? null,
		now,
		id
	);
}

export function failSearchIngestStat(id: number, error: string): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE search_ingest_stats SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`
	).run(error, now, id);
}

export function listRecentSearchIngestStats(limit = 20): SearchIngestStatRow[] {
	const db = getDb();
	return db
		.prepare('SELECT * FROM search_ingest_stats ORDER BY started_at DESC LIMIT ?')
		.all(limit) as SearchIngestStatRow[];
}

/** True when a prior Search pass for this hour already reconciled mostly-known repos. */
export function isHourSearchReconciled(
	hourKey: string,
	opts: { minFound?: number; minSkipRatio?: number } = {}
): boolean {
	const minFound = opts.minFound ?? 20;
	const minSkipRatio = opts.minSkipRatio ?? 0.95;
	const db = getDb();
	const row = db
		.prepare(
			`SELECT
			   COALESCE(SUM(found), 0) AS found,
			   COALESCE(SUM(inserted), 0) AS inserted,
			   COALESCE(SUM(skipped), 0) AS skipped
			 FROM search_ingest_stats
			 WHERE hour_key = ? AND status = 'completed'`
		)
		.get(hourKey) as { found: number; inserted: number; skipped: number };

	if (!row || row.found < minFound) return false;
	const skipRatio = row.skipped / row.found;
	return skipRatio >= minSkipRatio;
}

export function hasCompletedSearchForHour(hourKey: string): boolean {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT 1 AS ok FROM search_ingest_stats
			 WHERE hour_key = ? AND status = 'completed'
			 LIMIT 1`
		)
		.get(hourKey) as { ok: number } | undefined;
	return Boolean(row);
}

export function getSearchIngestSummary() {
	const db = getDb();
	const latest = db
		.prepare(
			`SELECT hour_key,
			        COUNT(*) as shard_count,
			        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_shards,
			        SUM(COALESCE(total_count, 0)) as total_count_sum,
			        SUM(found) as found_sum,
			        SUM(inserted) as inserted_sum,
			        SUM(skipped) as skipped_sum,
			        SUM(pages_fetched) as pages_sum
			 FROM search_ingest_stats
			 WHERE hour_key = (
			   SELECT hour_key FROM search_ingest_stats ORDER BY started_at DESC LIMIT 1
			 )
			 GROUP BY hour_key`
		)
		.get() as
		| {
				hour_key: string;
				shard_count: number;
				failed_shards: number;
				total_count_sum: number;
				found_sum: number;
				inserted_sum: number;
				skipped_sum: number;
				pages_sum: number;
		  }
		| undefined;

	const lastError = db
		.prepare(
			`SELECT error, started_at FROM search_ingest_stats
			 WHERE status = 'failed' AND error IS NOT NULL
			 ORDER BY started_at DESC LIMIT 1`
		)
		.get() as { error: string; started_at: string } | undefined;

	return { latest, lastError };
}
