import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { insertArchiveSnapshot } from '$lib/server/db/archive';
import { runBulkExport } from '$lib/server/bulk-export';
import { setupTestDb, teardownTestDb } from './helpers/db';
import { createTarGz } from './helpers/tar';

describe('bulk-export zip reuse', () => {
	let archiveDir: string;
	let exportsDir: string;

	beforeEach(() => {
		setupTestDb();
		archiveDir = mkdtempSync(join(tmpdir(), 'githubarchive-bulk-'));
		exportsDir = join(archiveDir, 'exports');
		process.env.ARCHIVE_DIR = archiveDir;
		process.env.EXPORTS_DIR = exportsDir;
	});

	afterEach(() => {
		if (archiveDir) rmSync(archiveDir, { recursive: true, force: true });
		teardownTestDb();
	});

	it('reuses per-repo zip snapshots instead of raw tarballs', async () => {
		const db = getDb();
		const now = '2026-07-07T12:00:00.000Z';
		db.prepare(
			`INSERT INTO repos (owner, name, full_name, github_url, event_id, created_at, first_seen_at, discovery_source, enriched_at, default_branch)
			 VALUES ('bulk', 'zip', 'bulk/zip', 'https://github.com/bulk/zip', 'e1', ?, ?, 'github_search', ?, 'main')`
		).run(now, now, now);
		const repo = db.prepare(`SELECT * FROM repos WHERE full_name = 'bulk/zip'`).get() as {
			id: number;
		};

		const tarball = createTarGz('bulk-zip-abc', 'app.js', 'module.exports = 1');
		const tarPath = join(archiveDir, 'bulk', 'zip', 'source.tar.gz');
		mkdirSync(join(archiveDir, 'bulk', 'zip'), { recursive: true });
		writeFileSync(tarPath, tarball);
		insertArchiveSnapshot({
			repo_id: repo.id,
			snapshot_type: 'source',
			file_path: tarPath,
			file_size: tarball.length,
			sha256: 'source',
			head_sha: 'head',
			archived_at: now
		});

		const zipPath = join(archiveDir, 'zips', 'bulk__zip__9.zip');
		mkdirSync(join(archiveDir, 'zips'), { recursive: true });
		writeFileSync(zipPath, Buffer.from('PK\x03\x04fake'));
		insertArchiveSnapshot({
			repo_id: repo.id,
			snapshot_type: 'zip',
			file_path: zipPath,
			file_size: 9,
			sha256: 'zip',
			head_sha: 'head',
			archived_at: now
		});

		const result = await runBulkExport({ scope: 'all', jobId: 77 });
		const sourceEntry = result.manifest.repos[0]?.snapshots.find((entry) => entry.type === 'zip');
		expect(sourceEntry?.reused_existing_zip).toBe(true);
		expect(sourceEntry?.zip_path).toBe('bulk/zip/source/zip.zip');
		expect(existsSync(result.zip_path)).toBe(true);
		expect(readFileSync(result.zip_path).subarray(0, 2).toString('hex')).toBe('504b');
	});
});
