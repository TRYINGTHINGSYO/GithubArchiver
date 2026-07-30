import {
	computeIngestTimeoutBackoffMs,
	ingestTimeoutBackoffBaseMs
} from '../ingest-hour-backoff.js';
import { getDb } from './connection.js';

export interface IngestHourBackoffRow {
	hour_key: string;
	consecutive_failures: number;
	last_error: string | null;
	last_failed_at: string;
	next_retry_at: string;
}

export function getIngestHourBackoff(hourKey: string): IngestHourBackoffRow | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM ingest_hour_backoff WHERE hour_key = ?').get(hourKey) as
		| IngestHourBackoffRow
		| undefined;
	return row ?? null;
}

/** True when this hour should be skipped from the next attempt batch. */
export function isHourInFetchBackoff(hourKey: string, nowMs: number = Date.now()): boolean {
	const row = getIngestHourBackoff(hourKey);
	if (!row?.next_retry_at) return false;
	return Date.parse(row.next_retry_at) > nowMs;
}

/**
 * Record a fetch/timeout failure and advance next_retry_at.
 * Does not mark the hour ingested — corpus gap remains visible to the planner count.
 */
export function recordHourFetchFailure(
	hourKey: string,
	error: string,
	nowMs: number = Date.now()
): IngestHourBackoffRow {
	const db = getDb();
	const prev = getIngestHourBackoff(hourKey);
	const failures = (prev?.consecutive_failures ?? 0) + 1;
	const backoffMs = computeIngestTimeoutBackoffMs(failures, ingestTimeoutBackoffBaseMs());
	const lastFailedAt = new Date(nowMs).toISOString();
	const nextRetryAt = new Date(nowMs + backoffMs).toISOString();
	const lastError = error.slice(0, 2000);

	db.prepare(
		`INSERT INTO ingest_hour_backoff (
		   hour_key, consecutive_failures, last_error, last_failed_at, next_retry_at
		 ) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(hour_key) DO UPDATE SET
		   consecutive_failures = excluded.consecutive_failures,
		   last_error = excluded.last_error,
		   last_failed_at = excluded.last_failed_at,
		   next_retry_at = excluded.next_retry_at`
	).run(hourKey, failures, lastError, lastFailedAt, nextRetryAt);

	return {
		hour_key: hourKey,
		consecutive_failures: failures,
		last_error: lastError,
		last_failed_at: lastFailedAt,
		next_retry_at: nextRetryAt
	};
}

/** Clear backoff after a successful ingest (or explicit reset). */
export function clearHourFetchBackoff(hourKey: string): void {
	getDb().prepare('DELETE FROM ingest_hour_backoff WHERE hour_key = ?').run(hourKey);
}

export function listIngestHourBackoffs(): IngestHourBackoffRow[] {
	return getDb()
		.prepare('SELECT * FROM ingest_hour_backoff ORDER BY next_retry_at ASC')
		.all() as IngestHourBackoffRow[];
}
