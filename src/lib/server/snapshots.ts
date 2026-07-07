import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { getArchiveSnapshotById, type ArchiveSnapshotRow } from '$lib/server/db/archive';

export function getArchiveDir(): string {
	return resolve(process.env.ARCHIVE_DIR ?? './data/archives');
}

export class SnapshotPathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SnapshotPathError';
	}
}

/** Resolve and validate a snapshot path is inside ARCHIVE_DIR. */
export function resolveSafeSnapshotPath(filePath: string): string {
	if (!filePath || filePath.includes('\0')) {
		throw new SnapshotPathError('Invalid file path');
	}

	const archiveDir = getArchiveDir();
	const resolvedFile = resolve(filePath);
	const resolvedArchive = resolve(archiveDir);
	const rel = relative(resolvedArchive, resolvedFile);

	if (rel.startsWith('..') || isAbsolute(rel)) {
		throw new SnapshotPathError('Path traversal rejected');
	}

	return resolvedFile;
}

export interface SnapshotFileMeta {
	id: number;
	repo_id: number;
	snapshot_type: 'readme' | 'source' | 'zip';
	file_path: string;
	file_size: number;
	sha256: string;
	head_sha: string | null;
	archived_at: string;
	file_exists: boolean;
	download_url: string;
}

export function enrichSnapshotMeta(row: ArchiveSnapshotRow): SnapshotFileMeta {
	let file_exists = false;
	try {
		const safePath = resolveSafeSnapshotPath(row.file_path);
		file_exists = existsSync(safePath);
	} catch {
		file_exists = false;
	}

	return {
		id: row.id,
		repo_id: row.repo_id,
		snapshot_type: row.snapshot_type,
		file_path: row.file_path,
		file_size: row.file_size,
		sha256: row.sha256,
		head_sha: row.head_sha,
		archived_at: row.archived_at,
		file_exists,
		download_url: `/api/snapshots/${row.id}`
	};
}

export function getSnapshotForDownload(id: number): {
	snapshot: ArchiveSnapshotRow;
	safePath: string;
} | null {
	const snapshot = getArchiveSnapshotById(id);
	if (!snapshot) return null;

	let safePath: string;
	try {
		safePath = resolveSafeSnapshotPath(snapshot.file_path);
	} catch {
		return null;
	}

	if (!existsSync(safePath)) return null;

	return { snapshot, safePath };
}

export function readSnapshotText(snapshot: ArchiveSnapshotRow): string | null {
	try {
		const safePath = resolveSafeSnapshotPath(snapshot.file_path);
		if (!existsSync(safePath)) return null;
		return readFileSync(safePath, 'utf8');
	} catch {
		return null;
	}
}

export function snapshotDownloadFilename(snapshot: ArchiveSnapshotRow, safePath: string): string {
	if (snapshot.snapshot_type === 'readme') {
		return basename(safePath) || 'README.md';
	}
	if (snapshot.snapshot_type === 'zip') {
		return basename(safePath) || 'source.zip';
	}
	return basename(safePath) || 'source.tar.gz';
}

export function snapshotContentType(snapshot: ArchiveSnapshotRow): string {
	if (snapshot.snapshot_type === 'readme') {
		return 'text/markdown; charset=utf-8';
	}
	if (snapshot.snapshot_type === 'zip') {
		return 'application/zip';
	}
	return 'application/gzip';
}
