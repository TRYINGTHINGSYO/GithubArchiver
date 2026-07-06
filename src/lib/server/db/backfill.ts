import { getDb } from './connection.js';
import { listHourKeysBetween, defaultHourKey } from '../gharchive.js';
import type { BackfillJobRow, BackfillHourRow } from './types.js';

export type BackfillSource = 'auto' | 'gharchive' | 'github_search';
export type BackfillJobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type BackfillHourStatus = 'pending' | 'running' | 'completed' | 'unavailable' | 'failed';

function hourToDate(hourKey: string): string {
	return `${hourKey.slice(0, 4)}-${hourKey.slice(5, 7)}-${hourKey.slice(8, 10)}`;
}

function hourToYear(hourKey: string): number {
	return Number(hourKey.slice(0, 4));
}

export function createBackfillJob(opts: {
	startDate: string;
	endDate: string;
	source: BackfillSource;
	maxHoursPerRun: number;
}): number {
	const db = getDb();
	const now = new Date().toISOString();
	const result = db
		.prepare(
			`INSERT INTO backfill_jobs (start_date, end_date, source, max_hours_per_run, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 'pending', ?, ?)`
		)
		.run(opts.startDate, opts.endDate, opts.source, opts.maxHoursPerRun, now, now);

	const jobId = Number(result.lastInsertRowid);
	seedBackfillHours(jobId, opts.startDate, opts.endDate);
	return jobId;
}

export function seedBackfillHours(jobId: number, startDate: string, endDate: string): number {
	const db = getDb();
	const from = `${startDate}-00`;
	const toHour = defaultHourKey();
	const end = endDate >= toHour.slice(0, 10) ? toHour : `${endDate}-23`;
	const hours = listHourKeysBetween(from, end);
	const now = new Date().toISOString();
	const insert = db.prepare(
		`INSERT OR IGNORE INTO backfill_hours
		 (job_id, hour_key, year, date, status, updated_at)
		 VALUES (?, ?, ?, ?, 'pending', ?)`
	);

	let added = 0;
	for (const hourKey of hours) {
		const r = insert.run(jobId, hourKey, hourToYear(hourKey), hourToDate(hourKey), now);
		added += r.changes;
	}
	return added;
}

export function getBackfillJob(id: number): BackfillJobRow | null {
	const db = getDb();
	return (
		(db.prepare('SELECT * FROM backfill_jobs WHERE id = ?').get(id) as BackfillJobRow | undefined) ??
		null
	);
}

export function getActiveBackfillJob(): BackfillJobRow | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT * FROM backfill_jobs
			 WHERE status IN ('pending', 'running', 'paused')
			 ORDER BY id DESC LIMIT 1`
		)
		.get() as BackfillJobRow | undefined;
	return row ?? null;
}

export function listBackfillJobs(limit = 20): BackfillJobRow[] {
	const db = getDb();
	return db
		.prepare('SELECT * FROM backfill_jobs ORDER BY id DESC LIMIT ?')
		.all(limit) as BackfillJobRow[];
}

export function updateBackfillJob(
	id: number,
	patch: Partial<Pick<BackfillJobRow, 'status' | 'last_error'>>
): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE backfill_jobs SET status = COALESCE(?, status), last_error = COALESCE(?, last_error), updated_at = ? WHERE id = ?`
	).run(patch.status ?? null, patch.last_error ?? null, now, id);
}

export function listPendingBackfillHours(jobId: number, limit: number): BackfillHourRow[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT * FROM backfill_hours
			 WHERE job_id = ? AND status = 'pending'
			 ORDER BY hour_key ASC
			 LIMIT ?`
		)
		.all(jobId, limit) as BackfillHourRow[];
}

export function resetRunningBackfillHours(jobId: number): number {
	const db = getDb();
	const now = new Date().toISOString();
	const result = db
		.prepare(
			`UPDATE backfill_hours SET status = 'pending', updated_at = ?
			 WHERE job_id = ? AND status = 'running'`
		)
		.run(now, jobId);
	return result.changes;
}

export function getLatestBackfillJob(): BackfillJobRow | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM backfill_jobs ORDER BY id DESC LIMIT 1').get() as
		| BackfillJobRow
		| undefined;
	return row ?? null;
}

export function markBackfillHourRunning(id: number): void {
	const db = getDb();
	db.prepare(
		`UPDATE backfill_hours SET status = 'running', updated_at = ? WHERE id = ?`
	).run(new Date().toISOString(), id);
}

export function completeBackfillHour(
	id: number,
	patch: {
		status: BackfillHourStatus;
		source?: string;
		eventsParsed?: number;
		reposInserted?: number;
		error?: string;
	}
): void {
	const db = getDb();
	db.prepare(
		`UPDATE backfill_hours SET
		   status = ?,
		   source = COALESCE(?, source),
		   events_parsed = COALESCE(?, events_parsed),
		   repos_inserted = COALESCE(?, repos_inserted),
		   error = ?,
		   updated_at = ?
		 WHERE id = ?`
	).run(
		patch.status,
		patch.source ?? null,
		patch.eventsParsed ?? null,
		patch.reposInserted ?? null,
		patch.error ?? null,
		new Date().toISOString(),
		id
	);
}

export function getBackfillProgress(jobId: number) {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT status, COUNT(*) as c FROM backfill_hours WHERE job_id = ? GROUP BY status`
		)
		.all(jobId) as { status: string; c: number }[];
	const map: Record<string, number> = {};
	for (const row of rows) map[row.status] = row.c;
	const total = Object.values(map).reduce((a, b) => a + b, 0);
	return {
		total,
		pending: map.pending ?? 0,
		running: map.running ?? 0,
		completed: map.completed ?? 0,
		unavailable: map.unavailable ?? 0,
		failed: map.failed ?? 0
	};
}

export function countBackfillHoursByYear(jobId: number): { year: number; completed: number; total: number }[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT year,
			        COUNT(*) as total,
			        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
			 FROM backfill_hours WHERE job_id = ?
			 GROUP BY year ORDER BY year`
		)
		.all(jobId) as { year: number; completed: number; total: number }[];
}

export function refreshBackfillJobStatus(jobId: number): void {
	const progress = getBackfillProgress(jobId);
	if (progress.pending === 0 && progress.running === 0) {
		const status = progress.failed > 0 ? 'failed' : 'completed';
		updateBackfillJob(jobId, { status });
	}
}
