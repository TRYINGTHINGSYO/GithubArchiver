import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDb } from './db/connection';

function backupsDir(): string {
	return process.env.BACKUPS_DIR ?? './data/backups';
}

export interface RetentionActionResult {
	id: string;
	name: string;
	applied: boolean;
	deleted: number;
	bytes_freed_estimate?: number;
	message: string;
}

export interface RetentionReport {
	actions: RetentionActionResult[];
	vacuumed: boolean;
	page_count_before: number | null;
	page_count_after: number | null;
}

export interface RetentionOptions {
	/** Delete completed/cancelled job_runs older than retention. Default true when apply. */
	jobRuns?: boolean;
	/** Collapse metrics to one snapshot per repo per day + age trim. */
	metrics?: boolean;
	/** Delete high-churn repository_events past retention. */
	events?: boolean;
	/** Prune old database backups by daily/weekly/monthly policy. */
	backups?: boolean;
	/** Run WAL checkpoint + VACUUM + optimize after deletes. */
	vacuum?: boolean;
	/** When false, only compute what would be deleted (best-effort). */
	apply?: boolean;
}

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function envCsv(name: string, fallback: string[]): string[] {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	return raw
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

/** Completed job history retention (days). Default 30. */
export function jobRunsSuccessRetentionDays(): number {
	return envInt('JOB_RUNS_RETENTION_DAYS', 30);
}

/** Failed/interrupted job history retention (days). Default 90. */
export function jobRunsFailedRetentionDays(): number {
	return envInt('JOB_RUNS_FAILED_RETENTION_DAYS', 90);
}

/** High-churn event types older than this many days are deleted. Default 120. */
export function eventRetentionDays(): number {
	return envInt('EVENT_RETENTION_DAYS', 120);
}

export function eventRetentionTypes(): string[] {
	return envCsv('EVENT_RETENTION_TYPES', ['metadata_updated', 'metrics_updated']);
}

/** Keep metric snapshots newer than this many days (after daily collapse). Default 365. */
export function metricsRetentionDays(): number {
	return envInt('METRICS_RETENTION_DAYS', 365);
}

export function backupKeepDaily(): number {
	return envInt('BACKUP_KEEP_DAILY', 7);
}

export function backupKeepWeekly(): number {
	return envInt('BACKUP_KEEP_WEEKLY', 4);
}

export function backupKeepMonthly(): number {
	return envInt('BACKUP_KEEP_MONTHLY', 3);
}

function pragmaNumber(sql: string): number | null {
	try {
		const row = getDb().pragma(sql, { simple: true }) as number | bigint | null;
		if (row == null) return null;
		return Number(row);
	} catch {
		return null;
	}
}

function isoDaysAgo(days: number): string {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function pruneJobRuns(apply: boolean): RetentionActionResult {
	const db = getDb();
	const successCutoff = isoDaysAgo(jobRunsSuccessRetentionDays());
	const failedCutoff = isoDaysAgo(jobRunsFailedRetentionDays());

	const successCount = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM job_runs
				 WHERE status IN ('success', 'cancelled')
				   AND COALESCE(finished_at, started_at) < ?`
			)
			.get(successCutoff) as { c: number }
	).c;
	const failedCount = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM job_runs
				 WHERE status IN ('failed', 'interrupted')
				   AND COALESCE(finished_at, started_at) < ?`
			)
			.get(failedCutoff) as { c: number }
	).c;
	const deleted = successCount + failedCount;

	if (apply && deleted > 0) {
		db.prepare(
			`DELETE FROM job_runs
			 WHERE status IN ('success', 'cancelled')
			   AND COALESCE(finished_at, started_at) < ?`
		).run(successCutoff);
		db.prepare(
			`DELETE FROM job_runs
			 WHERE status IN ('failed', 'interrupted')
			   AND COALESCE(finished_at, started_at) < ?`
		).run(failedCutoff);
	}

	return {
		id: 'prune_job_runs',
		name: 'Prune job_runs history',
		applied: apply && deleted > 0,
		deleted,
		message:
			deleted > 0
				? `${apply ? 'Deleted' : 'Would delete'} ${successCount} success/cancelled (>${jobRunsSuccessRetentionDays()}d) and ${failedCount} failed/interrupted (>${jobRunsFailedRetentionDays()}d).`
				: 'No aged job_runs rows to prune.'
	};
}

/**
 * Keep one metrics snapshot per repo per UTC day, then drop rows older than retention
 * while always retaining the latest snapshot for each repo.
 */
export function pruneMetricSnapshots(apply: boolean): RetentionActionResult {
	const db = getDb();
	const retentionCutoff = isoDaysAgo(metricsRetentionDays());

	const intraDayDupes = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repo_metrics_snapshots
				 WHERE id NOT IN (
				   SELECT MAX(id) FROM repo_metrics_snapshots
				   GROUP BY repo_id, substr(captured_at, 1, 10)
				 )`
			)
			.get() as { c: number }
	).c;

	const aged = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repo_metrics_snapshots s
				 WHERE s.captured_at < ?
				   AND s.id NOT IN (
				     SELECT id FROM (
				       SELECT id,
				              ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY captured_at DESC, id DESC) AS rn
				       FROM repo_metrics_snapshots
				     ) ranked
				     WHERE rn = 1
				   )`
			)
			.get(retentionCutoff) as { c: number }
	).c;

	const deleted = intraDayDupes + aged;

	if (apply && deleted > 0) {
		db.prepare(
			`DELETE FROM repo_metrics_snapshots
			 WHERE id NOT IN (
			   SELECT MAX(id) FROM repo_metrics_snapshots
			   GROUP BY repo_id, substr(captured_at, 1, 10)
			 )`
		).run();

		db.prepare(
			`DELETE FROM repo_metrics_snapshots
			 WHERE captured_at < ?
			   AND id NOT IN (
			     SELECT id FROM (
			       SELECT id,
			              ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY captured_at DESC, id DESC) AS rn
			       FROM repo_metrics_snapshots
			     ) ranked
			     WHERE rn = 1
			   )`
		).run(retentionCutoff);
	}

	return {
		id: 'prune_metrics',
		name: 'Collapse / age metric snapshots',
		applied: apply && deleted > 0,
		deleted,
		message:
			deleted > 0
				? `${apply ? 'Removed' : 'Would remove'} ${intraDayDupes} same-day duplicate(s) and ${aged} aged snapshot(s) (>${metricsRetentionDays()}d; latest per repo kept).`
				: 'No metric snapshots to collapse or age out.'
	};
}

export function pruneRepositoryEvents(apply: boolean): RetentionActionResult {
	const db = getDb();
	const types = eventRetentionTypes();
	const cutoff = isoDaysAgo(eventRetentionDays());
	if (types.length === 0) {
		return {
			id: 'prune_events',
			name: 'Prune high-churn repository events',
			applied: false,
			deleted: 0,
			message: 'EVENT_RETENTION_TYPES is empty; skipping event prune.'
		};
	}

	const placeholders = types.map(() => '?').join(', ');
	const count = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repository_events
				 WHERE event_type IN (${placeholders})
				   AND event_time < ?`
			)
			.get(...types, cutoff) as { c: number }
	).c;

	if (apply && count > 0) {
		db.prepare(
			`DELETE FROM repository_events
			 WHERE event_type IN (${placeholders})
			   AND event_time < ?`
		).run(...types, cutoff);
	}

	return {
		id: 'prune_events',
		name: 'Prune high-churn repository events',
		applied: apply && count > 0,
		deleted: count,
		message:
			count > 0
				? `${apply ? 'Deleted' : 'Would delete'} ${count} ${types.join('/')} event(s) older than ${eventRetentionDays()} days.`
				: `No ${types.join('/')} events older than ${eventRetentionDays()} days.`
	};
}

interface BackupEntry {
	dirName: string;
	mtime: number;
	paths: string[];
	bytes: number;
}

function directoryBytes(root: string): number {
	let total = 0;
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const full = join(root, entry.name);
		if (entry.isDirectory()) total += directoryBytes(full);
		else if (entry.isFile()) total += statSync(full).size;
	}
	return total;
}

function listBackupEntriesDetailed(backupsRoot: string): BackupEntry[] {
	if (!existsSync(backupsRoot)) return [];
	const byName = new Map<string, BackupEntry>();

	for (const name of readdirSync(backupsRoot)) {
		if (name.endsWith('.meta.json')) continue;
		const full = join(backupsRoot, name);
		const st = statSync(full);

		if (name.endsWith('.tar.gz')) {
			const dirName = name.slice(0, -'.tar.gz'.length);
			const current = byName.get(dirName) ?? {
				dirName,
				mtime: 0,
				paths: [],
				bytes: 0
			};
			current.mtime = Math.max(current.mtime, st.mtimeMs);
			current.paths.push(full);
			current.bytes += st.size;
			const sidecar = join(backupsRoot, `${dirName}.meta.json`);
			if (existsSync(sidecar) && !current.paths.includes(sidecar)) {
				current.paths.push(sidecar);
				current.bytes += statSync(sidecar).size;
			}
			byName.set(dirName, current);
			continue;
		}

		if (st.isDirectory()) {
			const current = byName.get(name) ?? {
				dirName: name,
				mtime: 0,
				paths: [],
				bytes: 0
			};
			current.mtime = Math.max(current.mtime, st.mtimeMs);
			current.paths.push(full);
			current.bytes += directoryBytes(full);
			const sidecar = join(backupsRoot, `${name}.meta.json`);
			if (existsSync(sidecar) && !current.paths.includes(sidecar)) {
				current.paths.push(sidecar);
				current.bytes += statSync(sidecar).size;
			}
			byName.set(name, current);
		}
	}

	return [...byName.values()].sort((a, b) => b.mtime - a.mtime);
}

function utcDayKey(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

function utcWeekKey(ms: number): string {
	const d = new Date(ms);
	const day = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() - day + 1);
	return d.toISOString().slice(0, 10);
}

function utcMonthKey(ms: number): string {
	return new Date(ms).toISOString().slice(0, 7);
}

/**
 * Keep newest backup always, plus up to N daily / weekly / monthly representatives.
 * Excess backups on the live volume are deleted.
 */
export function selectBackupsToDelete(entries: BackupEntry[]): BackupEntry[] {
	if (entries.length <= 1) return [];

	const keep = new Set<string>();
	keep.add(entries[0].dirName);

	const daily = backupKeepDaily();
	const weekly = backupKeepWeekly();
	const monthly = backupKeepMonthly();

	const seenDays = new Set<string>();
	const seenWeeks = new Set<string>();
	const seenMonths = new Set<string>();

	for (const entry of entries) {
		const day = utcDayKey(entry.mtime);
		if (seenDays.size < daily && !seenDays.has(day)) {
			seenDays.add(day);
			keep.add(entry.dirName);
		}
	}

	for (const entry of entries) {
		const week = utcWeekKey(entry.mtime);
		if (seenWeeks.size < weekly && !seenWeeks.has(week)) {
			seenWeeks.add(week);
			keep.add(entry.dirName);
		}
	}

	for (const entry of entries) {
		const month = utcMonthKey(entry.mtime);
		if (seenMonths.size < monthly && !seenMonths.has(month)) {
			seenMonths.add(month);
			keep.add(entry.dirName);
		}
	}

	return entries.filter((entry) => !keep.has(entry.dirName));
}

export function pruneBackups(apply: boolean): RetentionActionResult {
	const backupsRoot = resolve(backupsDir());
	const entries = listBackupEntriesDetailed(backupsRoot);
	const doomed = selectBackupsToDelete(entries);
	const bytes = doomed.reduce((sum, entry) => sum + entry.bytes, 0);

	if (apply) {
		for (const entry of doomed) {
			for (const path of entry.paths) {
				if (!existsSync(path)) continue;
				const st = statSync(path);
				if (st.isDirectory()) rmSync(path, { recursive: true, force: true });
				else unlinkSync(path);
			}
		}
	}

	return {
		id: 'prune_backups',
		name: 'Prune database backups',
		applied: apply && doomed.length > 0,
		deleted: doomed.length,
		bytes_freed_estimate: bytes,
		message:
			doomed.length > 0
				? `${apply ? 'Deleted' : 'Would delete'} ${doomed.length} backup(s) (~${Math.round(bytes / (1024 * 1024))} MB); keeping ${backupKeepDaily()} daily / ${backupKeepWeekly()} weekly / ${backupKeepMonthly()} monthly.`
				: `Backup retention satisfied (${backupKeepDaily()} daily / ${backupKeepWeekly()} weekly / ${backupKeepMonthly()} monthly).`
	};
}

export function vacuumDatabase(): RetentionActionResult {
	const db = getDb();
	db.pragma('wal_checkpoint(TRUNCATE)');
	db.exec('VACUUM');
	db.pragma('optimize');
	return {
		id: 'vacuum',
		name: 'VACUUM database',
		applied: true,
		deleted: 0,
		message: 'WAL checkpointed, VACUUM completed, and PRAGMA optimize ran.'
	};
}

export function runRetention(opts: RetentionOptions = {}): RetentionReport {
	const apply = opts.apply ?? false;
	const pageBefore = pragmaNumber('page_count');
	const actions: RetentionActionResult[] = [];

	if (opts.jobRuns ?? true) actions.push(pruneJobRuns(apply));
	if (opts.metrics ?? true) actions.push(pruneMetricSnapshots(apply));
	if (opts.events ?? true) actions.push(pruneRepositoryEvents(apply));
	if (opts.backups ?? true) actions.push(pruneBackups(apply));

	let vacuumed = false;
	if (opts.vacuum && apply) {
		actions.push(vacuumDatabase());
		vacuumed = true;
	}

	return {
		actions,
		vacuumed,
		page_count_before: pageBefore,
		page_count_after: pragmaNumber('page_count')
	};
}
