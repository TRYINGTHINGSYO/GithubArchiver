import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { getDb } from './db/connection';
import { CURRENT_SCHEMA_VERSION } from './db/schema';
import { countFtsIndexed, rebuildAllFts } from './db/fts';
import {
	getLatestDaemonJob,
	parseJobDetail
} from './db/jobs';
import { latestIngestedHour, countIngestedHours, listMissingHourKeys } from './db/ingestion';
import { countRepos } from './db/repos';
import type { ArchiveSnapshotRow } from './db/types';
import { defaultHourKey } from './gharchive';
import { getArchiveDir, resolveSafeSnapshotPath } from './snapshots';

export type CheckStatus = 'ok' | 'warn' | 'error';

export interface DoctorCheck {
	id: string;
	name: string;
	status: CheckStatus;
	message: string;
	count?: number;
	samples?: string[];
}

export interface DoctorRepair {
	id: string;
	name: string;
	applied: boolean;
	message: string;
	count?: number;
}

export interface DoctorReport {
	healthy: boolean;
	checks: DoctorCheck[];
	repairs: DoctorRepair[];
}

export interface DoctorOptions {
	repair?: boolean;
	rebuildFts?: boolean;
	markMissingSnapshots?: boolean;
}

const SAMPLE_LIMIT = 15;
const JOB_FAILURE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function envFlag(name: string): boolean {
	const value = process.env[name];
	return value === '1' || value === 'true';
}

function appliedSchemaVersion(): number {
	const db = getDb();
	const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as {
		v: number | null;
	};
	return row.v ?? 0;
}

function walkArchiveFiles(archiveDir: string): string[] {
	if (!existsSync(archiveDir)) return [];

	const files: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile()) {
				files.push(full);
			}
		}
	};
	walk(archiveDir);
	return files;
}

function listAllSnapshots(): ArchiveSnapshotRow[] {
	const db = getDb();
	return db.prepare('SELECT * FROM archive_snapshots ORDER BY id').all() as ArchiveSnapshotRow[];
}

function classifySnapshots(snapshots: ArchiveSnapshotRow[]) {
	const missing: ArchiveSnapshotRow[] = [];
	const broken: ArchiveSnapshotRow[] = [];

	for (const snapshot of snapshots) {
		try {
			const safePath = resolveSafeSnapshotPath(snapshot.file_path);
			if (!existsSync(safePath)) {
				missing.push(snapshot);
			}
		} catch {
			broken.push(snapshot);
		}
	}

	return { missing, broken };
}

function findOrphanArchiveFiles(snapshots: ArchiveSnapshotRow[]): string[] {
	const archiveDir = getArchiveDir();
	const referenced = new Set(
		snapshots
			.map((row) => {
				try {
					return resolveSafeSnapshotPath(row.file_path);
				} catch {
					return null;
				}
			})
			.filter((p): p is string => Boolean(p))
	);

	return walkArchiveFiles(archiveDir).filter((file) => !referenced.has(resolve(file)));
}

function formatSnapshotSample(snapshot: ArchiveSnapshotRow): string {
	return `#${snapshot.id} repo=${snapshot.repo_id} ${snapshot.snapshot_type} ${snapshot.file_path}`;
}

function checkDatabaseOpens(): DoctorCheck {
	try {
		getDb();
		return {
			id: 'database_opens',
			name: 'Database opens',
			status: 'ok',
			message: 'SQLite database opened successfully.'
		};
	} catch (err) {
		return {
			id: 'database_opens',
			name: 'Database opens',
			status: 'error',
			message: err instanceof Error ? err.message : 'Failed to open database'
		};
	}
}

function checkSchemaVersion(): DoctorCheck {
	const applied = appliedSchemaVersion();
	if (applied === CURRENT_SCHEMA_VERSION) {
		return {
			id: 'schema_version',
			name: 'Schema version',
			status: 'ok',
			message: `Schema v${applied} (current).`
		};
	}
	return {
		id: 'schema_version',
		name: 'Schema version',
		status: 'error',
		message: `Schema v${applied} applied; expected v${CURRENT_SCHEMA_VERSION}. Run npm run db:migrate.`,
		count: CURRENT_SCHEMA_VERSION - applied
	};
}

function checkMissingArchiveFiles(snapshots: ArchiveSnapshotRow[]): DoctorCheck {
	const { missing } = classifySnapshots(snapshots);
	if (missing.length === 0) {
		return {
			id: 'missing_archive_files',
			name: 'Missing archive files',
			status: 'ok',
			message: 'All snapshot files exist on disk.'
		};
	}
	return {
		id: 'missing_archive_files',
		name: 'Missing archive files',
		status: 'warn',
		message: `${missing.length} snapshot record(s) point to missing files.`,
		count: missing.length,
		samples: missing.slice(0, SAMPLE_LIMIT).map(formatSnapshotSample)
	};
}

function checkOrphanArchiveFiles(snapshots: ArchiveSnapshotRow[]): DoctorCheck {
	const orphans = findOrphanArchiveFiles(snapshots);
	if (orphans.length === 0) {
		return {
			id: 'orphan_archive_files',
			name: 'Orphan archive files',
			status: 'ok',
			message: 'No unreferenced files under ARCHIVE_DIR.'
		};
	}
	const archiveDir = getArchiveDir();
	return {
		id: 'orphan_archive_files',
		name: 'Orphan archive files',
		status: 'warn',
		message: `${orphans.length} file(s) on disk are not referenced by archive_snapshots.`,
		count: orphans.length,
		samples: orphans
			.slice(0, SAMPLE_LIMIT)
			.map((file) => relative(archiveDir, file).replace(/\\/g, '/'))
	};
}

function checkBrokenSnapshotPaths(snapshots: ArchiveSnapshotRow[]): DoctorCheck {
	const { broken } = classifySnapshots(snapshots);
	if (broken.length === 0) {
		return {
			id: 'broken_snapshot_paths',
			name: 'Broken snapshot paths',
			status: 'ok',
			message: 'All snapshot paths resolve inside ARCHIVE_DIR.'
		};
	}
	return {
		id: 'broken_snapshot_paths',
		name: 'Broken snapshot paths',
		status: 'error',
		message: `${broken.length} snapshot path(s) are invalid or outside ARCHIVE_DIR.`,
		count: broken.length,
		samples: broken.slice(0, SAMPLE_LIMIT).map(formatSnapshotSample)
	};
}

function checkFtsRowCount(): DoctorCheck {
	const db = getDb();
	const repoCount = countRepos();
	const ftsCount = countFtsIndexed();
	const orphanFts = (
		db
			.prepare(
				`SELECT COUNT(*) as c FROM repos_fts
				 WHERE repo_id NOT IN (SELECT id FROM repos)`
			)
			.get() as { c: number }
	).c;

	if (ftsCount === repoCount && orphanFts === 0) {
		return {
			id: 'fts_row_count',
			name: 'FTS row count',
			status: 'ok',
			message: `repos_fts has ${ftsCount} row(s), matching ${repoCount} repo(s).`
		};
	}

	return {
		id: 'fts_row_count',
		name: 'FTS row count',
		status: 'warn',
		message: `repos_fts=${ftsCount}, repos=${repoCount}, orphan FTS rows=${orphanFts}.`,
		count: Math.abs(repoCount - ftsCount) + orphanFts
	};
}

function checkRecentJobFailures(): DoctorCheck {
	const since = new Date(Date.now() - JOB_FAILURE_LOOKBACK_MS).toISOString();
	const db = getDb();
	const failures = db
		.prepare(
			`SELECT job_type, started_at, error FROM job_runs
			 WHERE status = 'failed' AND started_at >= ?
			 ORDER BY started_at DESC
			 LIMIT ?`
		)
		.all(since, SAMPLE_LIMIT) as { job_type: string; started_at: string; error: string | null }[];

	if (failures.length === 0) {
		return {
			id: 'recent_job_failures',
			name: 'Recent job failures',
			status: 'ok',
			message: 'No failed jobs in the last 24 hours.'
		};
	}

	const total = (
		db
			.prepare(
				`SELECT COUNT(*) as c FROM job_runs
				 WHERE status = 'failed' AND started_at >= ?`
			)
			.get(since) as { c: number }
	).c;

	return {
		id: 'recent_job_failures',
		name: 'Recent job failures',
		status: 'warn',
		message: `${total} failed job(s) in the last 24 hours.`,
		count: total,
		samples: failures.map((row) => `${row.job_type} @ ${row.started_at}${row.error ? `: ${row.error}` : ''}`)
	};
}

function checkDaemonCheckpoint(): DoctorCheck {
	const daemon = getLatestDaemonJob();
	const detail = daemon ? parseJobDetail(daemon) : null;
	const missing = listMissingHourKeys(20);
	const latest = latestIngestedHour();
	const target = defaultHourKey();
	const totalHours = countIngestedHours();

	if (!daemon) {
		return {
			id: 'daemon_checkpoint',
			name: 'Daemon checkpoint',
			status: 'warn',
			message: `No daemon runs recorded. ${totalHours} hour(s) ingested; target ${target}.`,
			count: missing.length,
			samples: missing.slice(0, SAMPLE_LIMIT)
		};
	}

	const running =
		daemon.status === 'running' &&
		Boolean(detail?.pid) &&
		Date.now() - new Date(daemon.started_at).getTime() < 30 * 60 * 1000;

	const parts = [
		`daemon ${running ? 'running' : daemon.status}`,
		`latest hour ${latest ?? '—'}`,
		`target ${target}`,
		`${missing.length} missing hour(s) queued`
	];

	return {
		id: 'daemon_checkpoint',
		name: 'Daemon checkpoint',
		status: missing.length > 0 ? 'warn' : 'ok',
		message: parts.join(' · '),
		count: missing.length,
		samples: missing.slice(0, SAMPLE_LIMIT)
	};
}

function repairRebuildFts(): DoctorRepair {
	const rebuilt = rebuildAllFts();
	return {
		id: 'rebuild_fts',
		name: 'Rebuild FTS index',
		applied: true,
		message: `Reindexed ${rebuilt} repo(s) into repos_fts.`,
		count: rebuilt
	};
}

function repairMarkMissingSnapshots(snapshots: ArchiveSnapshotRow[]): DoctorRepair {
	const { missing } = classifySnapshots(snapshots);
	if (missing.length === 0) {
		return {
			id: 'mark_missing_snapshots',
			name: 'Mark missing snapshots',
			applied: false,
			message: 'No missing snapshot files to mark.'
		};
	}

	const db = getDb();
	const remove = db.prepare('DELETE FROM archive_snapshots WHERE id = ?');
	for (const snapshot of missing) {
		remove.run(snapshot.id);
	}

	return {
		id: 'mark_missing_snapshots',
		name: 'Mark missing snapshots',
		applied: true,
		message: `Removed ${missing.length} archive_snapshots row(s) for missing files.`,
		count: missing.length
	};
}

export function runDoctor(opts: DoctorOptions = {}): DoctorReport {
	const repair = opts.repair ?? false;
	const checks: DoctorCheck[] = [];
	const repairs: DoctorRepair[] = [];

	checks.push(checkDatabaseOpens());
	if (checks[checks.length - 1].status === 'error') {
		return { healthy: false, checks, repairs };
	}

	let snapshots = listAllSnapshots();

	checks.push(checkSchemaVersion());
	checks.push(checkMissingArchiveFiles(snapshots));
	checks.push(checkOrphanArchiveFiles(snapshots));
	checks.push(checkBrokenSnapshotPaths(snapshots));
	checks.push(checkFtsRowCount());
	checks.push(checkRecentJobFailures());
	checks.push(checkDaemonCheckpoint());

	if (repair) {
		if (opts.rebuildFts || envFlag('DOCTOR_REBUILD_FTS')) {
			repairs.push(repairRebuildFts());
			checks[checks.findIndex((c) => c.id === 'fts_row_count')] = checkFtsRowCount();
		}

		if (opts.markMissingSnapshots || envFlag('DOCTOR_MARK_MISSING_SNAPSHOTS')) {
			repairs.push(repairMarkMissingSnapshots(snapshots));
			snapshots = listAllSnapshots();
			checks[checks.findIndex((c) => c.id === 'missing_archive_files')] =
				checkMissingArchiveFiles(snapshots);
		}
	}

	const healthy = checks.every((check) => check.status !== 'error');
	return { healthy, checks, repairs };
}

export function getDoctorReport(): DoctorReport {
	return runDoctor({ repair: false });
}
