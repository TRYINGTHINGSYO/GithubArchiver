import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { getLatestArchiveSnapshot } from '$lib/server/db/archive';
import { getDb } from '$lib/server/db/connection';
import { updateJobRun } from '$lib/server/db/jobs';
import type { RepoRow } from '$lib/server/db/types';
import { resolveSafeSnapshotPath } from '$lib/server/snapshots';

async function createZipArchive() {
	const mod = await import('archiver');
	return mod.default('zip', { zlib: { level: 6 } });
}

export type BulkExportScope = 'all' | 'active' | 'deleted';

export interface BulkExportManifestEntry {
	type: 'readme' | 'source';
	capture_reason: string;
	archived_at: string;
	zip_path: string;
	snapshot_id: number;
	file_size: number;
}

export interface BulkExportManifestRepo {
	owner: string;
	repo: string;
	full_name: string;
	deleted_at: string | null;
	snapshots: BulkExportManifestEntry[];
}

export interface BulkExportManifest {
	exported_at: string;
	scope: BulkExportScope;
	format: 'zip';
	repo_count: number;
	snapshot_count: number;
	skipped_missing_files: number;
	repos: BulkExportManifestRepo[];
}

export interface BulkExportResult {
	scope: BulkExportScope;
	format: 'zip';
	zip_path: string;
	zip_bytes: number;
	repo_count: number;
	snapshot_count: number;
	skipped_missing_files: number;
	manifest: BulkExportManifest;
}

const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
export const EXPORTS_DIR = resolve(process.env.EXPORTS_DIR ?? join(DATA_DIR, 'exports'));

function scopeWhere(scope: BulkExportScope): string {
	switch (scope) {
		case 'active':
			return 'r.deleted_at IS NULL';
		case 'deleted':
			return 'r.deleted_at IS NOT NULL';
		case 'all':
			return '1 = 1';
	}
}

function listReposForExport(scope: BulkExportScope): RepoRow[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT DISTINCT r.*
			 FROM repos r
			 WHERE ${scopeWhere(scope)}
			   AND EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id)
			 ORDER BY r.full_name`
		)
		.all() as RepoRow[];
}

function snapshotZipPath(owner: string, name: string, snapshotType: string, filePath: string): string {
	const ext = basename(filePath);
	return `${owner}/${name}/${snapshotType}/${ext}`;
}

export async function runBulkExport(opts: {
	scope: BulkExportScope;
	jobId: number;
	format?: 'zip';
}): Promise<BulkExportResult> {
	const scope = opts.scope;
	const format = opts.format ?? 'zip';
	if (format !== 'zip') {
		throw new Error('Only zip format is supported');
	}

	mkdirSync(EXPORTS_DIR, { recursive: true });
	const zipPath = join(EXPORTS_DIR, `bulk-export-${opts.jobId}.zip`);
	const repos = listReposForExport(scope);

	const manifest: BulkExportManifest = {
		exported_at: new Date().toISOString(),
		scope,
		format: 'zip',
		repo_count: 0,
		snapshot_count: 0,
		skipped_missing_files: 0,
		repos: []
	};

	const output = createWriteStream(zipPath);
	const archive = await createZipArchive();
	archive.pipe(output);

	let processed = 0;
	for (const repo of repos) {
		const entries: BulkExportManifestEntry[] = [];

		for (const snapshotType of ['readme', 'source'] as const) {
			const snapshot = getLatestArchiveSnapshot(repo.id, snapshotType);
			if (!snapshot) continue;

			let safePath: string | null = null;
			try {
				safePath = resolveSafeSnapshotPath(snapshot.file_path);
			} catch {
				manifest.skipped_missing_files++;
				continue;
			}

			if (!safePath || !existsSync(safePath)) {
				manifest.skipped_missing_files++;
				continue;
			}

			const zipEntry = snapshotZipPath(repo.owner, repo.name, snapshotType, snapshot.file_path);
			archive.file(safePath, { name: zipEntry });
			entries.push({
				type: snapshotType,
				capture_reason: snapshot.capture_reason ?? 'daemon',
				archived_at: snapshot.archived_at,
				zip_path: zipEntry,
				snapshot_id: snapshot.id,
				file_size: snapshot.file_size
			});
			manifest.snapshot_count++;
		}

		if (entries.length > 0) {
			manifest.repos.push({
				owner: repo.owner,
				repo: repo.name,
				full_name: repo.full_name,
				deleted_at: repo.deleted_at,
				snapshots: entries
			});
			manifest.repo_count++;
		}

		processed++;
		if (processed % 25 === 0) {
			updateJobRun(opts.jobId, {
				phase: 'building',
				scope,
				format,
				processed_repos: processed,
				total_repos: repos.length,
				snapshot_count: manifest.snapshot_count
			});
		}
	}

	archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
	await archive.finalize();
	await finished(output);

	const zipBytes = statSync(zipPath).size;

	return {
		scope,
		format: 'zip',
		zip_path: zipPath,
		zip_bytes: zipBytes,
		repo_count: manifest.repo_count,
		snapshot_count: manifest.snapshot_count,
		skipped_missing_files: manifest.skipped_missing_files,
		manifest
	};
}

export function getBulkExportZipPath(jobId: number): string {
	return join(EXPORTS_DIR, `bulk-export-${jobId}.zip`);
}
