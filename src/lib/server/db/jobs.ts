import { getDb } from './connection.js';
import type { JobRunRow, JobStatus, JobType } from './types.js';

export function startJobRun(
	jobType: JobType,
	detail: Record<string, unknown> = {},
	reason?: string | null
): number {
	const db = getDb();
	const startedAt = new Date().toISOString();
	const result = db
		.prepare(
			`INSERT INTO job_runs (job_type, status, started_at, detail_json, reason)
			 VALUES (?, 'running', ?, ?, ?)`
		)
		.run(jobType, startedAt, JSON.stringify(detail), reason ?? null);
	return Number(result.lastInsertRowid);
}

export function updateJobRun(
	id: number,
	detail: Record<string, unknown>,
	reason?: string | null
): void {
	const db = getDb();
	if (reason !== undefined) {
		db.prepare('UPDATE job_runs SET detail_json = ?, reason = ? WHERE id = ?').run(
			JSON.stringify(detail),
			reason,
			id
		);
		return;
	}
	db.prepare('UPDATE job_runs SET detail_json = ? WHERE id = ?').run(JSON.stringify(detail), id);
}

export function finishJobRun(
	id: number,
	status: Exclude<JobStatus, 'running'>,
	detail: Record<string, unknown> = {},
	error?: string,
	reason?: string | null
): void {
	const db = getDb();
	if (reason !== undefined) {
		db.prepare(
			`UPDATE job_runs
			 SET status = ?, finished_at = ?, detail_json = ?, error = ?, reason = ?
			 WHERE id = ?`
		).run(status, new Date().toISOString(), JSON.stringify(detail), error ?? null, reason, id);
		return;
	}
	db.prepare(
		`UPDATE job_runs
		 SET status = ?, finished_at = ?, detail_json = ?, error = ?
		 WHERE id = ?`
	).run(status, new Date().toISOString(), JSON.stringify(detail), error ?? null, id);
}

export function listRecentJobRuns(limit = 30): JobRunRow[] {
	const db = getDb();
	return db
		.prepare('SELECT * FROM job_runs ORDER BY started_at DESC LIMIT ?')
		.all(limit) as JobRunRow[];
}

export function getJobRunById(id: number): JobRunRow | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM job_runs WHERE id = ?').get(id) as JobRunRow | undefined;
	return row ?? null;
}

export function getRunningJobByType(jobType: JobType): JobRunRow | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT * FROM job_runs
			 WHERE job_type = ? AND status = 'running'
			 ORDER BY started_at DESC
			 LIMIT 1`
		)
		.get(jobType) as JobRunRow | undefined;
	return row ?? null;
}

export function listJobRuns(opts: { limit?: number; jobType?: string; offset?: number } = {}): JobRunRow[] {
	const db = getDb();
	const limit = opts.limit ?? 50;
	const offset = opts.offset ?? 0;
	if (opts.jobType) {
		return db
			.prepare(
				`SELECT * FROM job_runs WHERE job_type = ?
				 ORDER BY started_at DESC LIMIT ? OFFSET ?`
			)
			.all(opts.jobType, limit, offset) as JobRunRow[];
	}
	return db
		.prepare('SELECT * FROM job_runs ORDER BY started_at DESC LIMIT ? OFFSET ?')
		.all(limit, offset) as JobRunRow[];
}

export function getLatestDaemonJob(): JobRunRow | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT * FROM job_runs
			 WHERE job_type = 'daemon'
			 ORDER BY started_at DESC
			 LIMIT 1`
		)
		.get() as JobRunRow | undefined;
	return row ?? null;
}

export function getLatestJobsByType(): Partial<Record<JobType, JobRunRow>> {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT j.*
			 FROM job_runs j
			 INNER JOIN (
			   SELECT job_type, MAX(started_at) AS max_started
			   FROM job_runs
			   GROUP BY job_type
			 ) latest ON j.job_type = latest.job_type AND j.started_at = latest.max_started`
		)
		.all() as JobRunRow[];

	const map: Partial<Record<JobType, JobRunRow>> = {};
	for (const row of rows) map[row.job_type] = row;
	return map;
}

export function parseJobDetail(row: JobRunRow): Record<string, unknown> {
	try {
		return JSON.parse(row.detail_json) as Record<string, unknown>;
	} catch {
		return {};
	}
}

const DEFAULT_ORPHAN_JOB_AGE_MS = 10 * 60 * 1000;

export function reconcileOrphanedJobRuns(
	maxAgeMs: number = DEFAULT_ORPHAN_JOB_AGE_MS,
	nowMs: number = Date.now()
): number {
	const db = getDb();
	const cutoff = new Date(nowMs - maxAgeMs).toISOString();
	const orphans = db
		.prepare(
			`SELECT id FROM job_runs
			 WHERE status = 'running' AND started_at < ?`
		)
		.all(cutoff) as { id: number }[];

	const reason = 'orphaned: process restarted mid-run';
	for (const row of orphans) {
		// Deploy/restart abandonments are not processing failures.
		finishJobRun(row.id, 'interrupted', { orphaned: true }, reason, reason);
	}

	return orphans.length;
}
