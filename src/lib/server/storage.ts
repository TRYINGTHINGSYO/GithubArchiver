import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { getDb } from './db/connection';
import type { ArchiveSnapshotRow } from './db/types';
import { getArchiveDir, resolveSafeSnapshotPath } from './snapshots';

export interface StorageRepoSize {
	repo_id: number;
	full_name: string;
	snapshot_count: number;
	total_bytes: number;
}

export interface StorageDuplicateGroup {
	sha256: string;
	count: number;
	total_bytes: number;
	snapshot_ids: number[];
	file_paths: string[];
}

export interface StorageOldSnapshot {
	id: number;
	repo_id: number;
	full_name: string;
	snapshot_type: string;
	archived_at: string;
	file_size: number;
	file_path: string;
}

export interface StorageCleanup {
	id: string;
	name: string;
	applied: boolean;
	message: string;
	count?: number;
	bytes_freed?: number;
}

export interface StorageReport {
	total_bytes_on_disk: number;
	total_bytes_indexed: number;
	snapshot_count: number;
	file_count_on_disk: number;
	largest_repos: StorageRepoSize[];
	duplicate_groups: StorageDuplicateGroup[];
	duplicate_bytes_recoverable: number;
	missing_db_rows: string[];
	missing_db_bytes: number;
	old_snapshots: StorageOldSnapshot[];
	old_snapshot_bytes: number;
	keep_last_n: number;
	cleanups: StorageCleanup[];
}

export interface StorageOptions {
	cleanup?: boolean;
	deleteOrphans?: boolean;
	deleteDuplicates?: boolean;
	trimOld?: boolean;
}

const SAMPLE_LIMIT = 20;

function envFlag(name: string): boolean {
	const value = process.env[name];
	return value === '1' || value === 'true';
}

function keepLastNValue(): number {
	const raw = process.env.STORAGE_KEEP_LAST_N;
	const n = raw === undefined || raw === '' ? 5 : Number(raw);
	return Math.max(1, Number.isFinite(n) ? n : 5);
}

function ageTrimEnabled(cleanup: boolean): boolean {
	return cleanup && process.env.STORAGE_KEEP_LAST_N !== undefined && process.env.STORAGE_KEEP_LAST_N !== '';
}

function walkArchiveFiles(archiveDir: string): { path: string; size: number }[] {
	if (!existsSync(archiveDir)) return [];

	const files: { path: string; size: number }[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile()) {
				files.push({ path: full, size: statSync(full).size });
			}
		}
	};
	walk(archiveDir);
	return files;
}

function listAllSnapshots(): (ArchiveSnapshotRow & { full_name: string })[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT a.*, r.full_name
			 FROM archive_snapshots a
			 JOIN repos r ON r.id = a.repo_id
			 ORDER BY a.repo_id, a.snapshot_type, a.archived_at DESC`
		)
		.all() as (ArchiveSnapshotRow & { full_name: string })[];
}

function buildProtectedIds(snapshots: ArchiveSnapshotRow[]): Set<number> {
	const latest = new Map<string, ArchiveSnapshotRow>();
	for (const snapshot of snapshots) {
		const key = `${snapshot.repo_id}:${snapshot.snapshot_type}`;
		const current = latest.get(key);
		if (
			!current ||
			snapshot.archived_at > current.archived_at ||
			(snapshot.archived_at === current.archived_at && snapshot.id > current.id)
		) {
			latest.set(key, snapshot);
		}
	}
	return new Set([...latest.values()].map((s) => s.id));
}

function resolveSnapshotPath(snapshot: ArchiveSnapshotRow): string | null {
	try {
		return resolveSafeSnapshotPath(snapshot.file_path);
	} catch {
		return null;
	}
}

function pathRefCounts(snapshots: ArchiveSnapshotRow[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const snapshot of snapshots) {
		const path = resolveSnapshotPath(snapshot);
		if (!path) continue;
		counts.set(path, (counts.get(path) ?? 0) + 1);
	}
	return counts;
}

function deleteSnapshotRow(id: number): void {
	getDb().prepare('DELETE FROM archive_snapshots WHERE id = ?').run(id);
}

function deleteSnapshotFile(
	snapshot: ArchiveSnapshotRow,
	refCounts: Map<string, number>
): number {
	const path = resolveSnapshotPath(snapshot);
	let freed = 0;
	if (path && existsSync(path)) {
		const refs = refCounts.get(path) ?? 0;
		if (refs <= 1) {
			freed = statSync(path).size;
			rmSync(path, { force: true });
		}
		if (path) refCounts.set(path, Math.max(0, refs - 1));
	}
	deleteSnapshotRow(snapshot.id);
	return freed;
}

function analyzeLargestRepos(limit = SAMPLE_LIMIT): StorageRepoSize[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT r.id as repo_id, r.full_name,
			        COUNT(a.id) as snapshot_count,
			        COALESCE(SUM(a.file_size), 0) as total_bytes
			 FROM archive_snapshots a
			 JOIN repos r ON r.id = a.repo_id
			 GROUP BY r.id
			 ORDER BY total_bytes DESC
			 LIMIT ?`
		)
		.all(limit) as StorageRepoSize[];
}

function analyzeDuplicates(snapshots: ArchiveSnapshotRow[]): {
	groups: StorageDuplicateGroup[];
	recoverable: number;
} {
	const bySha = new Map<string, ArchiveSnapshotRow[]>();
	for (const snapshot of snapshots) {
		if (!snapshot.sha256) continue;
		const list = bySha.get(snapshot.sha256) ?? [];
		list.push(snapshot);
		bySha.set(snapshot.sha256, list);
	}

	const groups: StorageDuplicateGroup[] = [];
	let recoverable = 0;

	for (const [sha256, rows] of bySha) {
		if (rows.length < 2) continue;
		const bytes = rows.reduce((sum, row) => sum + row.file_size, 0);
		recoverable += bytes - rows[0].file_size;
		groups.push({
			sha256,
			count: rows.length,
			total_bytes: bytes,
			snapshot_ids: rows.map((r) => r.id),
			file_paths: [...new Set(rows.map((r) => r.file_path))]
		});
	}

	groups.sort((a, b) => b.total_bytes - a.total_bytes);
	return { groups: groups.slice(0, SAMPLE_LIMIT), recoverable };
}

function findOrphanFiles(
	snapshots: ArchiveSnapshotRow[],
	diskFiles: { path: string; size: number }[]
): { paths: string[]; bytes: number } {
	const archiveDir = getArchiveDir();
	const referenced = new Set<string>();
	for (const snapshot of snapshots) {
		const path = resolveSnapshotPath(snapshot);
		if (path) referenced.add(resolve(path));
	}

	const orphans: { path: string; size: number }[] = [];
	for (const file of diskFiles) {
		if (!referenced.has(resolve(file.path))) {
			orphans.push(file);
		}
	}

	orphans.sort((a, b) => b.size - a.size);
	return {
		paths: orphans
			.slice(0, SAMPLE_LIMIT)
			.map((f) => relative(archiveDir, f.path).replace(/\\/g, '/')),
		bytes: orphans.reduce((sum, f) => sum + f.size, 0)
	};
}

function findOldSnapshots(
	snapshots: (ArchiveSnapshotRow & { full_name: string })[],
	protectedIds: Set<number>,
	keepLastN: number
): { rows: StorageOldSnapshot[]; bytes: number } {
	const byKey = new Map<string, (ArchiveSnapshotRow & { full_name: string })[]>();
	for (const snapshot of snapshots) {
		const key = `${snapshot.repo_id}:${snapshot.snapshot_type}`;
		const list = byKey.get(key) ?? [];
		list.push(snapshot);
		byKey.set(key, list);
	}

	const old: StorageOldSnapshot[] = [];
	let bytes = 0;

	for (const rows of byKey.values()) {
		const sorted = [...rows].sort((a, b) => {
			if (a.archived_at !== b.archived_at) return a.archived_at < b.archived_at ? 1 : -1;
			return b.id - a.id;
		});
		for (let i = 0; i < sorted.length; i++) {
			const snapshot = sorted[i];
			if (protectedIds.has(snapshot.id)) continue;
			if (i < keepLastN) continue;
			old.push({
				id: snapshot.id,
				repo_id: snapshot.repo_id,
				full_name: snapshot.full_name,
				snapshot_type: snapshot.snapshot_type,
				archived_at: snapshot.archived_at,
				file_size: snapshot.file_size,
				file_path: snapshot.file_path
			});
			bytes += snapshot.file_size;
		}
	}

	old.sort((a, b) => a.archived_at.localeCompare(b.archived_at));
	return { rows: old.slice(0, SAMPLE_LIMIT), bytes };
}

function cleanupOrphans(
	snapshots: ArchiveSnapshotRow[],
	diskFiles: { path: string; size: number }[]
): StorageCleanup {
	const archiveDir = getArchiveDir();
	const referenced = new Set<string>();
	for (const snapshot of snapshots) {
		const path = resolveSnapshotPath(snapshot);
		if (path) referenced.add(resolve(path));
	}

	let count = 0;
	let bytesFreed = 0;
	for (const file of diskFiles) {
		if (!referenced.has(resolve(file.path))) {
			bytesFreed += file.size;
			rmSync(file.path, { force: true });
			count++;
		}
	}

	return {
		id: 'delete_orphans',
		name: 'Delete orphan files',
		applied: count > 0,
		message:
			count > 0
				? `Deleted ${count} unreferenced file(s) under ${archiveDir}.`
				: 'No orphan files to delete.',
		count,
		bytes_freed: bytesFreed
	};
}

function cleanupDuplicates(
	snapshots: ArchiveSnapshotRow[],
	protectedIds: Set<number>
): { cleanup: StorageCleanup; remaining: ArchiveSnapshotRow[] } {
	const refCounts = pathRefCounts(snapshots);
	const bySha = new Map<string, ArchiveSnapshotRow[]>();
	for (const snapshot of snapshots) {
		const list = bySha.get(snapshot.sha256) ?? [];
		list.push(snapshot);
		bySha.set(snapshot.sha256, list);
	}

	let count = 0;
	let bytesFreed = 0;
	const deletedIds = new Set<number>();

	for (const rows of bySha.values()) {
		if (rows.length < 2) continue;

		const sorted = [...rows].sort((a, b) => {
			if (a.archived_at !== b.archived_at) return a.archived_at < b.archived_at ? 1 : -1;
			return b.id - a.id;
		});

		const keeper =
			sorted.find((row) => protectedIds.has(row.id)) ??
			sorted.find((row) => {
				const path = resolveSnapshotPath(row);
				return path && existsSync(path);
			}) ??
			sorted[0];

		for (const snapshot of sorted) {
			if (snapshot.id === keeper.id) continue;
			if (protectedIds.has(snapshot.id)) continue;
			if (deletedIds.has(snapshot.id)) continue;
			bytesFreed += deleteSnapshotFile(snapshot, refCounts);
			deletedIds.add(snapshot.id);
			count++;
		}
	}

	const remaining = snapshots.filter((s) => !deletedIds.has(s.id));
	return {
		cleanup: {
			id: 'delete_duplicates',
			name: 'Delete duplicate SHA-256 snapshots',
			applied: count > 0,
			message:
				count > 0
					? `Removed ${count} duplicate snapshot(s); latest README/source kept.`
					: 'No duplicate snapshots to remove.',
			count,
			bytes_freed: bytesFreed
		},
		remaining
	};
}

function cleanupOldSnapshots(
	snapshots: (ArchiveSnapshotRow & { full_name: string })[],
	protectedIds: Set<number>,
	keepLastN: number
): { cleanup: StorageCleanup; remaining: ArchiveSnapshotRow[] } {
	const refCounts = pathRefCounts(snapshots);
	const byKey = new Map<string, (ArchiveSnapshotRow & { full_name: string })[]>();
	for (const snapshot of snapshots) {
		const key = `${snapshot.repo_id}:${snapshot.snapshot_type}`;
		const list = byKey.get(key) ?? [];
		list.push(snapshot);
		byKey.set(key, list);
	}

	let count = 0;
	let bytesFreed = 0;
	const deletedIds = new Set<number>();

	for (const rows of byKey.values()) {
		const sorted = [...rows].sort((a, b) => {
			if (a.archived_at !== b.archived_at) return a.archived_at < b.archived_at ? 1 : -1;
			return b.id - a.id;
		});
		for (let i = 0; i < sorted.length; i++) {
			const snapshot = sorted[i];
			if (protectedIds.has(snapshot.id)) continue;
			if (i < keepLastN) continue;
			bytesFreed += deleteSnapshotFile(snapshot, refCounts);
			deletedIds.add(snapshot.id);
			count++;
		}
	}

	const remaining = snapshots.filter((s) => !deletedIds.has(s.id));
	return {
		cleanup: {
			id: 'trim_old_snapshots',
			name: `Trim to last ${keepLastN} per type`,
			applied: count > 0,
			message:
				count > 0
					? `Removed ${count} old snapshot(s); latest README/source kept.`
					: `No snapshots older than keep-last-${keepLastN} to remove.`,
			count,
			bytes_freed: bytesFreed
		},
		remaining
	};
}

export function runStorageAnalysis(opts: StorageOptions = {}): StorageReport {
	const cleanup = opts.cleanup ?? false;
	const keepLastN = keepLastNValue();
	const archiveDir = getArchiveDir();
	const diskFiles = walkArchiveFiles(archiveDir);
	const totalBytesOnDisk = diskFiles.reduce((sum, f) => sum + f.size, 0);

	let snapshots = listAllSnapshots();
	const protectedIds = buildProtectedIds(snapshots);
	const cleanups: StorageCleanup[] = [];

	if (cleanup && (opts.deleteOrphans || envFlag('STORAGE_DELETE_ORPHANS'))) {
		cleanups.push(cleanupOrphans(snapshots, diskFiles));
	}

	if (cleanup && (opts.deleteDuplicates || envFlag('STORAGE_DELETE_DUPLICATES'))) {
		const result = cleanupDuplicates(snapshots, protectedIds);
		cleanups.push(result.cleanup);
		snapshots = result.remaining as (ArchiveSnapshotRow & { full_name: string })[];
	}

	if (opts.trimOld || ageTrimEnabled(cleanup)) {
		const result = cleanupOldSnapshots(snapshots, protectedIds, keepLastN);
		cleanups.push(result.cleanup);
		snapshots = result.remaining as (ArchiveSnapshotRow & { full_name: string })[];
	}

	const refreshedDiskFiles = cleanup ? walkArchiveFiles(archiveDir) : diskFiles;
	const refreshedTotalOnDisk = refreshedDiskFiles.reduce((sum, f) => sum + f.size, 0);
	const indexedBytes = snapshots.reduce((sum, s) => sum + s.file_size, 0);
	const { groups, recoverable } = analyzeDuplicates(snapshots);
	const orphans = findOrphanFiles(snapshots, refreshedDiskFiles);
	const old = findOldSnapshots(snapshots, protectedIds, keepLastN);

	return {
		total_bytes_on_disk: refreshedTotalOnDisk,
		total_bytes_indexed: indexedBytes,
		snapshot_count: snapshots.length,
		file_count_on_disk: refreshedDiskFiles.length,
		largest_repos: analyzeLargestRepos(),
		duplicate_groups: groups,
		duplicate_bytes_recoverable: recoverable,
		missing_db_rows: orphans.paths,
		missing_db_bytes: orphans.bytes,
		old_snapshots: old.rows,
		old_snapshot_bytes: old.bytes,
		keep_last_n: keepLastN,
		cleanups
	};
}

export function getStorageReport(): StorageReport {
	return runStorageAnalysis({ cleanup: false });
}
