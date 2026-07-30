import { defaultHourKey, parseHourKey } from '$lib/server/gharchive';
import { getDb } from './connection';

/**
 * Permanent per-hour archive ingest spans.
 *
 * These exist so fetch, parse, and commit cannot collapse back into one
 * misleading "fetch timed out" number. One row per successfully downloaded hour.
 */
export interface ArchiveHourMetrics {
	hour_key: string;
	recorded_at: string;
	archive_fetch_ms: number;
	archive_parse_ms: number;
	archive_commit_ms: number;
	archive_hour_total_ms: number;
	archive_rows_created: number;
	archive_rows_existing: number;
	archive_batches: number;
	archive_deferred_rows: number;
	archive_frontier_lag_hours: number;
	parsed_events: number;
	repo_creates: number;
}

export interface ArchiveHourMetricsInput {
	hourKey: string;
	archiveFetchMs: number;
	archiveParseMs: number;
	archiveCommitMs: number;
	archiveHourTotalMs: number;
	archiveRowsCreated: number;
	archiveRowsExisting: number;
	archiveBatches: number;
	archiveDeferredRows: number;
	parsedEvents: number;
	repoCreates: number;
	/** Override "now" for frontier lag (tests). */
	nowMs?: number;
}

/** Hours between this archive hour and the current GH Archive frontier hour. */
export function archiveFrontierLagHours(
	hourKey: string,
	nowMs: number = Date.now()
): number {
	const frontier = parseHourKey(defaultHourKey(nowMs)).getTime();
	const hour = parseHourKey(hourKey).getTime();
	return Math.max(0, (frontier - hour) / 3_600_000);
}

export function recordArchiveHourMetrics(input: ArchiveHourMetricsInput): void {
	const db = getDb();
	const recordedAt = new Date(input.nowMs ?? Date.now()).toISOString();
	const lag = archiveFrontierLagHours(input.hourKey, input.nowMs);
	db.prepare(
		`INSERT INTO archive_hour_metrics (
			hour_key, recorded_at,
			archive_fetch_ms, archive_parse_ms, archive_commit_ms, archive_hour_total_ms,
			archive_rows_created, archive_rows_existing, archive_batches, archive_deferred_rows,
			archive_frontier_lag_hours, parsed_events, repo_creates
		 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(hour_key) DO UPDATE SET
			recorded_at = excluded.recorded_at,
			archive_fetch_ms = excluded.archive_fetch_ms,
			archive_parse_ms = excluded.archive_parse_ms,
			archive_commit_ms = excluded.archive_commit_ms,
			archive_hour_total_ms = excluded.archive_hour_total_ms,
			archive_rows_created = excluded.archive_rows_created,
			archive_rows_existing = excluded.archive_rows_existing,
			archive_batches = excluded.archive_batches,
			archive_deferred_rows = excluded.archive_deferred_rows,
			archive_frontier_lag_hours = excluded.archive_frontier_lag_hours,
			parsed_events = excluded.parsed_events,
			repo_creates = excluded.repo_creates`
	).run(
		input.hourKey,
		recordedAt,
		input.archiveFetchMs,
		input.archiveParseMs,
		input.archiveCommitMs,
		input.archiveHourTotalMs,
		input.archiveRowsCreated,
		input.archiveRowsExisting,
		input.archiveBatches,
		input.archiveDeferredRows,
		lag,
		input.parsedEvents,
		input.repoCreates
	);
}

export function getArchiveHourMetrics(hourKey: string): ArchiveHourMetrics | null {
	const row = getDb()
		.prepare(`SELECT * FROM archive_hour_metrics WHERE hour_key = ?`)
		.get(hourKey) as ArchiveHourMetrics | undefined;
	return row ?? null;
}

export function listRecentArchiveHourMetrics(limit = 24): ArchiveHourMetrics[] {
	return getDb()
		.prepare(
			`SELECT * FROM archive_hour_metrics
			 ORDER BY recorded_at DESC
			 LIMIT ?`
		)
		.all(limit) as ArchiveHourMetrics[];
}

/** Rolling averages over the most recent N recorded hours. */
export function summarizeArchiveHourMetrics(limit = 24): {
	samples: number;
	avgFetchMs: number;
	avgParseMs: number;
	avgCommitMs: number;
	avgTotalMs: number;
	avgRowsCreated: number;
	latestFrontierLagHours: number | null;
} {
	const rows = listRecentArchiveHourMetrics(limit);
	if (rows.length === 0) {
		return {
			samples: 0,
			avgFetchMs: 0,
			avgParseMs: 0,
			avgCommitMs: 0,
			avgTotalMs: 0,
			avgRowsCreated: 0,
			latestFrontierLagHours: null
		};
	}
	const n = rows.length;
	const sum = (fn: (r: ArchiveHourMetrics) => number) =>
		rows.reduce((acc, r) => acc + fn(r), 0);
	return {
		samples: n,
		avgFetchMs: sum((r) => r.archive_fetch_ms) / n,
		avgParseMs: sum((r) => r.archive_parse_ms) / n,
		avgCommitMs: sum((r) => r.archive_commit_ms) / n,
		avgTotalMs: sum((r) => r.archive_hour_total_ms) / n,
		avgRowsCreated: sum((r) => r.archive_rows_created) / n,
		latestFrontierLagHours: rows[0]?.archive_frontier_lag_hours ?? null
	};
}
