import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BACKUPS_DIR } from './backup';
import { getDatabasePath, getDb } from './db/connection';
import { getArchiveDir } from './snapshots';
import { isMetadataOnlyMode } from './runtime-mode';

export interface DbTableSize {
	name: string;
	bytes: number;
	megabytes: number;
}

export interface DbRowCount {
	name: string;
	count: number;
}

export interface DuplicateGithubIdGroup {
	github_id: number;
	duplicate_count: number;
	repo_ids: number[];
	full_names: string[];
}

export interface DuplicateOwnerNameGroup {
	owner: string;
	name: string;
	duplicate_count: number;
	repo_ids: number[];
	full_names: string[];
}

export interface PathUsage {
	path: string;
	exists: boolean;
	bytes: number;
	file_count: number;
}

export interface DatabaseInventory {
	database_path: string;
	database_bytes: number;
	wal_bytes: number;
	shm_bytes: number;
	page_count: number | null;
	page_size: number | null;
	freelist_count: number | null;
	table_sizes: DbTableSize[];
	row_counts: DbRowCount[];
	duplicate_github_ids: DuplicateGithubIdGroup[];
	duplicate_owner_names: DuplicateOwnerNameGroup[];
	backups: PathUsage;
	archives: PathUsage;
	artifact_archive_enabled: boolean;
	metadata_only: boolean;
}

const SAMPLE_LIMIT = 20;

const ROW_COUNT_TABLES = [
	'repos',
	'repository_events',
	'repo_metrics_snapshots',
	'job_runs',
	'archive_snapshots',
	'releases',
	'release_assets',
	'repo_aliases',
	'daemon_decisions',
	'search_ingest_stats'
] as const;

function pathBytes(path: string): number {
	if (!existsSync(path)) return 0;
	const st = statSync(path);
	if (st.isFile()) return st.size;
	let total = 0;
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		total += pathBytes(join(path, entry.name));
	}
	return total;
}

function pathFileCount(path: string): number {
	if (!existsSync(path)) return 0;
	const st = statSync(path);
	if (st.isFile()) return 1;
	let count = 0;
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		count += pathFileCount(join(path, entry.name));
	}
	return count;
}

function pathUsage(path: string): PathUsage {
	const resolved = resolve(path);
	return {
		path: resolved,
		exists: existsSync(resolved),
		bytes: pathBytes(resolved),
		file_count: pathFileCount(resolved)
	};
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

export function getDatabaseTableSizes(limit = SAMPLE_LIMIT): DbTableSize[] {
	const db = getDb();
	try {
		return (
			db
				.prepare(
					`SELECT name,
					        SUM(pgsize) AS bytes,
					        ROUND(SUM(pgsize) / 1024.0 / 1024.0, 2) AS megabytes
					 FROM dbstat
					 GROUP BY name
					 ORDER BY bytes DESC
					 LIMIT ?`
				)
				.all(limit) as DbTableSize[]
		).map((row) => ({
			name: row.name,
			bytes: Number(row.bytes) || 0,
			megabytes: Number(row.megabytes) || 0
		}));
	} catch {
		// dbstat is unavailable when SQLite was built without it.
		return [];
	}
}

export function getDatabaseRowCounts(): DbRowCount[] {
	const db = getDb();
	const out: DbRowCount[] = [];
	for (const name of ROW_COUNT_TABLES) {
		try {
			const row = db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get() as { c: number };
			out.push({ name, count: row.c });
		} catch {
			// Table may not exist on older schemas mid-migration.
		}
	}
	return out;
}

export function findDuplicateGithubIds(limit = SAMPLE_LIMIT): DuplicateGithubIdGroup[] {
	const db = getDb();
	try {
		const rows = db
			.prepare(
				`SELECT github_id,
				        COUNT(*) AS duplicate_count,
				        GROUP_CONCAT(id) AS repo_ids,
				        GROUP_CONCAT(full_name) AS full_names
				 FROM repos
				 WHERE github_id IS NOT NULL
				 GROUP BY github_id
				 HAVING COUNT(*) > 1
				 ORDER BY duplicate_count DESC
				 LIMIT ?`
			)
			.all(limit) as Array<{
			github_id: number;
			duplicate_count: number;
			repo_ids: string;
			full_names: string;
		}>;
		return rows.map((row) => ({
			github_id: row.github_id,
			duplicate_count: row.duplicate_count,
			repo_ids: row.repo_ids.split(',').map((id) => Number(id)),
			full_names: row.full_names.split(',')
		}));
	} catch {
		return [];
	}
}

export function findDuplicateOwnerNames(limit = SAMPLE_LIMIT): DuplicateOwnerNameGroup[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT LOWER(owner) AS owner,
			        LOWER(name) AS name,
			        COUNT(*) AS duplicate_count,
			        GROUP_CONCAT(id) AS repo_ids,
			        GROUP_CONCAT(full_name) AS full_names
			 FROM repos
			 GROUP BY LOWER(owner), LOWER(name)
			 HAVING COUNT(*) > 1
			 ORDER BY duplicate_count DESC
			 LIMIT ?`
		)
		.all(limit) as Array<{
		owner: string;
		name: string;
		duplicate_count: number;
		repo_ids: string;
		full_names: string;
	}>;
	return rows.map((row) => ({
		owner: row.owner,
		name: row.name,
		duplicate_count: row.duplicate_count,
		repo_ids: row.repo_ids.split(',').map((id) => Number(id)),
		full_names: row.full_names.split(',')
	}));
}

export function getDatabaseInventory(): DatabaseInventory {
	const databasePath = resolve(getDatabasePath());
	const walPath = `${databasePath}-wal`;
	const shmPath = `${databasePath}-shm`;
	const metadataOnly = isMetadataOnlyMode();

	return {
		database_path: databasePath,
		database_bytes: existsSync(databasePath) ? statSync(databasePath).size : 0,
		wal_bytes: existsSync(walPath) ? statSync(walPath).size : 0,
		shm_bytes: existsSync(shmPath) ? statSync(shmPath).size : 0,
		page_count: pragmaNumber('page_count'),
		page_size: pragmaNumber('page_size'),
		freelist_count: pragmaNumber('freelist_count'),
		table_sizes: getDatabaseTableSizes(),
		row_counts: getDatabaseRowCounts(),
		duplicate_github_ids: findDuplicateGithubIds(),
		duplicate_owner_names: findDuplicateOwnerNames(),
		backups: pathUsage(BACKUPS_DIR),
		archives: pathUsage(getArchiveDir()),
		artifact_archive_enabled: !metadataOnly,
		metadata_only: metadataOnly
	};
}
