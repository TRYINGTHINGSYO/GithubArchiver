import { defaultHourKey, hourKey, listHourKeysBetween } from '../gharchive.js';
import { getDb } from './connection.js';
import type { IngestionStateRow } from './types.js';

export function isHourIngested(hourKey: string): boolean {
	const db = getDb();
	const row = db.prepare('SELECT 1 FROM ingestion_state WHERE hour_key = ?').get(hourKey);
	return Boolean(row);
}

export function recordHourIngested(
	hourKey: string,
	stats: { events: number; inserted: number; skipped: number; source?: string }
): void {
	const db = getDb();
	const source = stats.source ?? 'gharchive';
	db.prepare(
		`INSERT INTO ingestion_state (hour_key, ingested_at, events, inserted, skipped, source)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(hour_key) DO UPDATE SET
		   ingested_at = excluded.ingested_at,
		   events = excluded.events,
		   inserted = excluded.inserted,
		   skipped = excluded.skipped,
		   source = excluded.source`
	).run(hourKey, new Date().toISOString(), stats.events, stats.inserted, stats.skipped, source);
}

export function listIngestedHours(limit = 50): IngestionStateRow[] {
	const db = getDb();
	return db
		.prepare('SELECT * FROM ingestion_state ORDER BY hour_key DESC LIMIT ?')
		.all(limit) as IngestionStateRow[];
}

export function countIngestedHours(): number {
	const db = getDb();
	const row = db.prepare('SELECT COUNT(*) as c FROM ingestion_state').get() as { c: number };
	return row.c;
}

function ingestRangeStart(): string {
	const fromEnv = process.env.DAEMON_INGEST_FROM;
	if (fromEnv) return fromEnv;

	const db = getDb();
	const row = db
		.prepare('SELECT hour_key FROM ingestion_state ORDER BY hour_key ASC LIMIT 1')
		.get() as { hour_key: string } | undefined;

	if (row) return row.hour_key;

	const now = new Date();
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	return hourKey(start);
}

/** Completed GH Archive hours not yet recorded in ingestion_state. */
export function listMissingHourKeys(limit?: number): string[] {
	const upTo = defaultHourKey();
	const from = ingestRangeStart();
	const all = listHourKeysBetween(from, upTo);
	const db = getDb();

	const ingested = new Set(
		(db.prepare('SELECT hour_key FROM ingestion_state').all() as { hour_key: string }[]).map(
			(r) => r.hour_key
		)
	);

	const missing = all.filter((k) => !ingested.has(k));
	const maxHours = limit ?? Number(process.env.DAEMON_INGEST_MAX_HOURS ?? 6);
	return missing.slice(0, maxHours);
}

export function latestIngestedHour(): string | null {
	const db = getDb();
	const row = db
		.prepare('SELECT hour_key FROM ingestion_state ORDER BY hour_key DESC LIMIT 1')
		.get() as { hour_key: string } | undefined;
	return row?.hour_key ?? null;
}
