import { getDb } from './connection.js';
import type { JobRunRow, JobStatus, JobType } from './types.js';
import { formatDurationCompact } from '$lib/utils';
import { boundedInteger } from '../number-params.js';

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
	const limit = boundedInteger(opts.limit, 50, { min: 1, max: 200 });
	const offset = boundedInteger(opts.offset, 0, { min: 0, max: 1_000_000 });
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

/** UI "stale" warning threshold (default 10m) — early signal before the hard kill. */
const DEFAULT_STALE_RUNNING_JOB_MS = 10 * 60 * 1000;
/**
 * Hard ceiling for force-interrupt (default 15m). Slightly above enrich/ingest
 * burst budgets so a healthy long cycle is not false-positived.
 */
const DEFAULT_ORPHAN_JOB_AGE_MS = 15 * 60 * 1000;

/** Homepage stale badge — running work jobs older than this are likely wedged. */
export function staleRunningJobAgeMs(): number {
	const n = Number(process.env.STALE_RUNNING_JOB_MS ?? DEFAULT_STALE_RUNNING_JOB_MS);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_STALE_RUNNING_JOB_MS;
}

/** Hard running-ceiling for reconcile sweeps (boot + periodic). */
export function orphanJobAgeMs(): number {
	const n = Number(process.env.ORPHAN_JOB_AGE_MS ?? DEFAULT_ORPHAN_JOB_AGE_MS);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_ORPHAN_JOB_AGE_MS;
}

export interface ReconcileOrphansOpts {
	/** Skip these ids (e.g. the live in-process daemon row). */
	excludeIds?: Iterable<number>;
	/** Stored on job_runs.error/reason. */
	reason?: string;
	/**
	 * When true and any rows are reclaimed, log at error level — the primary
	 * in-job timeout failed and the safety net had to fire.
	 */
	alert?: boolean;
}

export interface ReconcileOrphansResult {
	count: number;
	ids: number[];
}

/**
 * Force-interrupt `running` job_runs older than maxAgeMs.
 * Pass maxAgeMs=0 at process boot to reclaim every leftover row from a dead process
 * (a 10m floor previously skipped crash orphans that were only minutes old).
 */
export function reconcileOrphanedJobRuns(
	maxAgeMs: number = orphanJobAgeMs(),
	nowMs: number = Date.now(),
	opts: ReconcileOrphansOpts = {}
): number {
	return reconcileOrphanedJobRunsDetailed(maxAgeMs, nowMs, opts).count;
}

export function reconcileOrphanedJobRunsDetailed(
	maxAgeMs: number = orphanJobAgeMs(),
	nowMs: number = Date.now(),
	opts: ReconcileOrphansOpts = {}
): ReconcileOrphansResult {
	const db = getDb();
	const cutoff = new Date(nowMs - maxAgeMs).toISOString();
	const exclude = new Set(opts.excludeIds ?? []);
	const reason = opts.reason ?? 'orphaned: process restarted mid-run';
	const orphans = (
		db
			.prepare(
				`SELECT id, job_type, started_at FROM job_runs
				 WHERE status = 'running' AND started_at < ?`
			)
			.all(cutoff) as { id: number; job_type: string; started_at: string }[]
	).filter((row) => !exclude.has(row.id));

	const ids: number[] = [];
	for (const row of orphans) {
		finishJobRun(
			row.id,
			'interrupted',
			{
				orphaned: true,
				job_type: row.job_type,
				started_at: row.started_at,
				reconcile_reason: reason
			},
			reason,
			reason
		);
		ids.push(row.id);
	}

	if (opts.alert && ids.length > 0) {
		console.error(
			`[jobs] SAFETY NET: force-interrupted ${ids.length} stuck running job_run(s) ` +
				`ids=[${ids.join(', ')}] — primary in-job timeout/finish path failed to close them`
		);
	}

	return { count: ids.length, ids };
}

/**
 * Non-daemon jobs currently `running` (ingest/enrich/…).
 * The daemon row itself is long-lived and excluded from wedge detection.
 */
export function listRunningWorkJobs(): JobRunRow[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT * FROM job_runs
			 WHERE status = 'running' AND job_type != 'daemon'
			 ORDER BY started_at ASC`
		)
		.all() as JobRunRow[];
}

export type RunningWorkJobSnapshot = {
	id: number;
	jobType: JobType;
	startedAt: string;
	ageMs: number;
	ageLabel: string;
	/** True when age exceeds the orphan/stale threshold (likely wedged). */
	stale: boolean;
	runningCount: number;
};

/**
 * Longest-running non-daemon job for homepage/status surfaces.
 * Returns null when no work job is in flight.
 */
export function getLongestRunningWorkJobSnapshot(
	nowMs: number = Date.now()
): RunningWorkJobSnapshot | null {
	const rows = listRunningWorkJobs();
	if (rows.length === 0) return null;
	const oldest = rows[0]!;
	const ageMs = Math.max(0, nowMs - Date.parse(oldest.started_at));
	return {
		id: oldest.id,
		jobType: oldest.job_type,
		startedAt: oldest.started_at,
		ageMs,
		ageLabel: formatDurationCompact(ageMs),
		stale: ageMs >= staleRunningJobAgeMs(),
		runningCount: rows.length
	};
}
