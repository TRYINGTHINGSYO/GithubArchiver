import { getDb } from './connection.js';

export type ScheduledJobName =
	| 'ingest'
	| 'enrich'
	| 'refresh'
	| 'classify'
	| 'clusters'
	| 'score'
	| 'stories'
	| 'emerging'
	| 'discovery'
	| 'archive'
	| 'deletionCheck'
	| 'backup';

export interface ScheduledJobRow {
	job_name: string;
	last_started_at: string | null;
	last_completed_at: string | null;
	next_run_at: string | null;
	status: string | null;
	last_error: string | null;
	consecutive_failures: number;
}

export function listScheduledJobs(): ScheduledJobRow[] {
	const db = getDb();
	return db.prepare('SELECT * FROM scheduled_jobs ORDER BY job_name').all() as ScheduledJobRow[];
}

export function getScheduledJob(jobName: ScheduledJobName): ScheduledJobRow | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM scheduled_jobs WHERE job_name = ?').get(jobName) as
		| ScheduledJobRow
		| undefined;
	return row ?? null;
}

export function ensureScheduledJobs(jobNames: ScheduledJobName[]): void {
	const db = getDb();
	const now = new Date().toISOString();
	const stmt = db.prepare(
		`INSERT INTO scheduled_jobs (job_name, status, next_run_at, consecutive_failures)
		 VALUES (?, 'pending', ?, 0)
		 ON CONFLICT(job_name) DO NOTHING`
	);
	for (const jobName of jobNames) {
		stmt.run(jobName, now);
	}
}

export function isJobDue(jobName: ScheduledJobName, now = Date.now()): boolean {
	const row = getScheduledJob(jobName);
	if (!row?.next_run_at) return true;
	return Date.parse(row.next_run_at) <= now;
}

export function markJobStarted(jobName: ScheduledJobName): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO scheduled_jobs (job_name, last_started_at, status, consecutive_failures)
		 VALUES (?, ?, 'running', 0)
		 ON CONFLICT(job_name) DO UPDATE SET
		   last_started_at = excluded.last_started_at,
		   status = 'running'`
	).run(jobName, now);
}

export function markJobCompleted(
	jobName: ScheduledJobName,
	intervalMs: number,
	now = Date.now()
): void {
	const db = getDb();
	const completedAt = new Date(now).toISOString();
	const nextRunAt = new Date(now + intervalMs).toISOString();
	db.prepare(
		`INSERT INTO scheduled_jobs (
		   job_name, last_completed_at, next_run_at, status, last_error, consecutive_failures
		 ) VALUES (?, ?, ?, 'success', NULL, 0)
		 ON CONFLICT(job_name) DO UPDATE SET
		   last_completed_at = excluded.last_completed_at,
		   next_run_at = excluded.next_run_at,
		   status = 'success',
		   last_error = NULL,
		   consecutive_failures = 0`
	).run(jobName, completedAt, nextRunAt);
}

export function markJobFailed(jobName: ScheduledJobName, error: string, intervalMs: number): void {
	const db = getDb();
	const row = getScheduledJob(jobName);
	const failures = (row?.consecutive_failures ?? 0) + 1;
	const backoff = Math.min(intervalMs * 2 ** Math.min(failures - 1, 4), intervalMs * 8);
	const nextRunAt = new Date(Date.now() + backoff).toISOString();
	db.prepare(
		`INSERT INTO scheduled_jobs (
		   job_name, next_run_at, status, last_error, consecutive_failures
		 ) VALUES (?, ?, 'failed', ?, ?)
		 ON CONFLICT(job_name) DO UPDATE SET
		   next_run_at = excluded.next_run_at,
		   status = 'failed',
		   last_error = excluded.last_error,
		   consecutive_failures = excluded.consecutive_failures`
	).run(jobName, nextRunAt, error.slice(0, 2000), failures);
}
