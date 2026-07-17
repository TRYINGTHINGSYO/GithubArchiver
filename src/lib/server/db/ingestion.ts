import { defaultHourKey, listHourKeysBetween, hourKey, parseHourKey } from '../gharchive.js';
import {
	shouldExcludeHourFromMissingBacklog,
	type HourUnavailableState
} from '../gharchive-hours.js';
import { getDb } from './connection.js';
import type { IngestionStateRow } from './types.js';

export function isHourIngested(hourKey: string): boolean {
	const row = getHourIngestionState(hourKey);
	return Boolean(row && row.unavailable_at == null);
}

export function getHourIngestionState(hourKey: string): IngestionStateRow | null {
	const db = getDb();
	const row = db
		.prepare('SELECT * FROM ingestion_state WHERE hour_key = ?')
		.get(hourKey) as IngestionStateRow | undefined;
	return row ?? null;
}

export function recordHourIngested(
	hourKey: string,
	stats: {
		events: number;
		inserted: number;
		skipped: number;
		source?: string;
		/** Matched repository births from GH Archive (not total parsed events). */
		matchedRepoCreates?: number;
	}
): void {
	const db = getDb();
	const source = stats.source ?? 'gharchive';
	const matchedRepoCreates = stats.matchedRepoCreates ?? 0;
	db.prepare(
		`INSERT INTO ingestion_state
		   (hour_key, ingested_at, events, matched_repo_creates, inserted, skipped, source, unavailable_at, http_status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
		 ON CONFLICT(hour_key) DO UPDATE SET
		   ingested_at = excluded.ingested_at,
		   events = excluded.events,
		   matched_repo_creates = excluded.matched_repo_creates,
		   inserted = excluded.inserted,
		   skipped = excluded.skipped,
		   source = excluded.source,
		   unavailable_at = NULL,
		   http_status = NULL`
	).run(
		hourKey,
		new Date().toISOString(),
		stats.events,
		matchedRepoCreates,
		stats.inserted,
		stats.skipped,
		source
	);
}

export function recordHourUnavailable(hourKey: string, httpStatus: number): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO ingestion_state
		   (hour_key, ingested_at, events, matched_repo_creates, inserted, skipped, source, unavailable_at, http_status)
		 VALUES (?, ?, 0, 0, 0, 0, 'gharchive', ?, ?)
		 ON CONFLICT(hour_key) DO UPDATE SET
		   ingested_at = excluded.ingested_at,
		   unavailable_at = excluded.unavailable_at,
		   http_status = excluded.http_status`
	).run(hourKey, now, now, httpStatus);
}

export function listIngestedHours(limit = 50): IngestionStateRow[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT * FROM ingestion_state
			 WHERE unavailable_at IS NULL
			 ORDER BY hour_key DESC LIMIT ?`
		)
		.all(limit) as IngestionStateRow[];
}

export function countIngestedHours(): number {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT COUNT(*) as c FROM ingestion_state WHERE unavailable_at IS NULL`
		)
		.get() as { c: number };
	return row.c;
}

function ingestRangeStart(): string {
	const fromEnv = process.env.DAEMON_INGEST_FROM;
	if (fromEnv) return fromEnv;

	const db = getDb();
	const row = db
		.prepare(
			`SELECT hour_key FROM ingestion_state
			 WHERE unavailable_at IS NULL
			 ORDER BY hour_key ASC LIMIT 1`
		)
		.get() as { hour_key: string } | undefined;

	if (row) return row.hour_key;

	const now = new Date();
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	return hourKey(start);
}

function unavailableState(row: IngestionStateRow | undefined): HourUnavailableState | null {
	if (!row?.unavailable_at) return null;
	return { unavailable_at: row.unavailable_at, http_status: row.http_status };
}

function collectMissingHourKeys(nowMs: number = Date.now()): string[] {
	const upTo = defaultHourKey(nowMs);
	const from = ingestRangeStart();
	const all = listHourKeysBetween(from, upTo);
	const db = getDb();

	const stateByKey = new Map<string, IngestionStateRow>();
	for (const row of db.prepare('SELECT * FROM ingestion_state').all() as IngestionStateRow[]) {
		stateByKey.set(row.hour_key, row);
	}

	return all.filter((key) => {
		const row = stateByKey.get(key);
		if (row && row.unavailable_at == null) return false;
		if (shouldExcludeHourFromMissingBacklog(key, unavailableState(row), nowMs)) return false;
		return true;
	});
}

/** Full filtered count for daemon priority (no batch slice). */
export function countMissingGhArchiveHours(nowMs: number = Date.now()): number {
	return collectMissingHourKeys(nowMs).length;
}

/** GH Archive hours that should drive ingest priority (excludes unpublished / cooling-down 404s). */
export function listMissingHourKeys(limit?: number, nowMs: number = Date.now()): string[] {
	const maxHours = limit ?? Number(process.env.DAEMON_INGEST_MAX_HOURS ?? 6);
	return collectMissingHourKeys(nowMs).slice(0, maxHours);
}

export function latestIngestedHour(): string | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT hour_key FROM ingestion_state
			 WHERE unavailable_at IS NULL
			 ORDER BY hour_key DESC LIMIT 1`
		)
		.get() as { hour_key: string } | undefined;
	return row?.hour_key ?? null;
}
