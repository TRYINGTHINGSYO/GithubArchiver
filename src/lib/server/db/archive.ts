import { getDb } from './connection';
import type { ArchiveSnapshotRow, NewArchiveSnapshot } from './types';

export function insertArchiveSnapshot(snapshot: NewArchiveSnapshot): number {
	const database = getDb();
	const captureReason = snapshot.capture_reason ?? 'daemon';
	const result = database
		.prepare(
			`INSERT INTO archive_snapshots
			 (repo_id, snapshot_type, file_path, file_size, sha256, head_sha, archived_at, capture_reason)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			snapshot.repo_id,
			snapshot.snapshot_type,
			snapshot.file_path,
			snapshot.file_size,
			snapshot.sha256,
			snapshot.head_sha,
			snapshot.archived_at,
			captureReason
		);
	return Number(result.lastInsertRowid);
}

export function listArchiveSnapshots(repoId: number): ArchiveSnapshotRow[] {
	const database = getDb();
	return database
		.prepare(`SELECT * FROM archive_snapshots WHERE repo_id = ? ORDER BY archived_at DESC`)
		.all(repoId) as ArchiveSnapshotRow[];
}

export function getLatestSourceHeadSha(repoId: number): string | null {
	const database = getDb();
	const row = database
		.prepare(
			`SELECT head_sha FROM archive_snapshots
			 WHERE repo_id = ? AND snapshot_type = 'source' AND head_sha IS NOT NULL
			 ORDER BY archived_at DESC LIMIT 1`
		)
		.get(repoId) as { head_sha: string } | undefined;
	return row?.head_sha ?? null;
}

export function getLatestReadmeSha256(repoId: number): string | null {
	const database = getDb();
	const row = database
		.prepare(
			`SELECT sha256 FROM archive_snapshots
			 WHERE repo_id = ? AND snapshot_type = 'readme'
			 ORDER BY archived_at DESC LIMIT 1`
		)
		.get(repoId) as { sha256: string } | undefined;
	return row?.sha256 ?? null;
}

export function getLatestReadmePath(repoId: number): string | null {
	const database = getDb();
	const row = database
		.prepare(
			`SELECT file_path FROM archive_snapshots
			 WHERE repo_id = ? AND snapshot_type = 'readme'
			 ORDER BY archived_at DESC LIMIT 1`
		)
		.get(repoId) as { file_path: string } | undefined;
	return row?.file_path ?? null;
}

export function getArchiveSnapshotById(id: number): ArchiveSnapshotRow | null {
	const database = getDb();
	const row = database.prepare('SELECT * FROM archive_snapshots WHERE id = ?').get(id) as
		| ArchiveSnapshotRow
		| undefined;
	return row ?? null;
}

export function getArchiveSnapshotForRepo(
	repoId: number,
	snapshotId: number
): ArchiveSnapshotRow | null {
	const database = getDb();
	const row = database
		.prepare('SELECT * FROM archive_snapshots WHERE id = ? AND repo_id = ?')
		.get(snapshotId, repoId) as ArchiveSnapshotRow | undefined;
	return row ?? null;
}
