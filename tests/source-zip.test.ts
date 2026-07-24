import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { getLatestArchiveSnapshot, insertArchiveSnapshot } from '$lib/server/db/archive';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/db/schema';
import {
	createZipSnapshotForSource,
	ensureZipForLatestSource,
	getRepoZipDownloadUrl,
	sourceZipFilePath,
	writeSourceZipFromTarball
} from '$lib/server/source-zip';
import { setupTestDb, teardownTestDb } from './helpers/db';
import { createTarGz } from './helpers/tar';

describe('source-zip', () => {
	let archiveDir: string;

	beforeEach(() => {
		setupTestDb();
		archiveDir = mkdtempSync(join(tmpdir(), 'githubarchive-zip-'));
		process.env.ARCHIVE_DIR = archiveDir;
		process.env.ENABLE_ARTIFACT_ARCHIVE = '1';
	});

	afterEach(() => {
		if (archiveDir) rmSync(archiveDir, { recursive: true, force: true });
		delete process.env.ENABLE_ARTIFACT_ARCHIVE;
		teardownTestDb();
	});

	it('applies current schema migrations for zip snapshot index', () => {
		const db = getDb();
		const version = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;
		expect(version).toBe(CURRENT_SCHEMA_VERSION);
		expect(CURRENT_SCHEMA_VERSION).toBe(35);	});

	it('builds predictable zip paths under ARCHIVE_DIR/zips', () => {
		expect(sourceZipFilePath('octo', 'hello', 42)).toBe(join(archiveDir, 'zips', 'octo__hello__42.zip'));
	});

	it('creates a zip from a github-style source tarball', async () => {
		const tarball = createTarGz('octo-hello-deadbeef', 'README.md', '# hello');
		const zipPath = join(archiveDir, 'zips', 'test.zip');
		const size = await writeSourceZipFromTarball(tarball, zipPath);

		expect(size).toBeGreaterThan(0);
		expect(existsSync(zipPath)).toBe(true);
		const zipBytes = readFileSync(zipPath);
		expect(zipBytes.subarray(0, 2).toString('hex')).toBe('504b');
	});

	it('records zip snapshot and reuses it for download URLs', async () => {
		const db = getDb();
		const now = '2026-07-07T12:00:00.000Z';
		db.prepare(
			`INSERT INTO repos (owner, name, full_name, github_url, event_id, created_at, first_seen_at, discovery_source, enriched_at, default_branch)
			 VALUES ('zip', 'test', 'zip/test', 'https://github.com/zip/test', 'e1', ?, ?, 'github_search', ?, 'main')`
		).run(now, now, now);
		const repo = db.prepare(`SELECT * FROM repos WHERE full_name = 'zip/test'`).get() as {
			id: number;
			owner: string;
			name: string;
		};

		const tarball = createTarGz('zip-test-abc', 'main.ts', 'export const x = 1;');
		const tarPath = join(archiveDir, 'zip', 'test', 'source.tar.gz');
		mkdirSync(join(archiveDir, 'zip', 'test'), { recursive: true });
		writeFileSync(tarPath, tarball);

		const sourceId = insertArchiveSnapshot({
			repo_id: repo.id,
			snapshot_type: 'source',
			file_path: tarPath,
			file_size: tarball.length,
			sha256: 'source-hash',
			head_sha: 'abc123',
			archived_at: now
		});

		const sourceSnapshot = {
			id: sourceId,
			repo_id: repo.id,
			snapshot_type: 'source' as const,
			file_path: tarPath,
			file_size: tarball.length,
			sha256: 'source-hash',
			head_sha: 'abc123',
			archived_at: now,
			capture_reason: 'daemon'
		};

		const zipId = await createZipSnapshotForSource(repo, sourceSnapshot, tarball, now, 'daemon');
		expect(zipId).toBeTruthy();

		const zipSnapshot = getLatestArchiveSnapshot(repo.id, 'zip');
		expect(zipSnapshot?.file_path).toBe(sourceZipFilePath(repo.owner, repo.name, zipId!));
		expect(existsSync(zipSnapshot!.file_path)).toBe(true);

		expect(getRepoZipDownloadUrl(repo.owner, repo.name, repo.id)).toBe(`/api/snapshots/${zipId}`);
	});

	it('backfills zip snapshots for legacy source archives', async () => {
		const db = getDb();
		const now = '2026-07-07T12:00:00.000Z';
		db.prepare(
			`INSERT INTO repos (owner, name, full_name, github_url, event_id, created_at, first_seen_at, discovery_source, enriched_at, default_branch)
			 VALUES ('legacy', 'repo', 'legacy/repo', 'https://github.com/legacy/repo', 'e2', ?, ?, 'github_search', ?, 'main')`
		).run(now, now, now);
		const repo = db.prepare(`SELECT * FROM repos WHERE full_name = 'legacy/repo'`).get() as {
			id: number;
			owner: string;
			name: string;
		};

		const tarball = createTarGz('legacy-repo-abc', 'index.js', 'console.log(1)');
		const tarPath = join(archiveDir, 'legacy', 'repo', 'source.tar.gz');
		mkdirSync(join(archiveDir, 'legacy', 'repo'), { recursive: true });
		writeFileSync(tarPath, tarball);

		insertArchiveSnapshot({
			repo_id: repo.id,
			snapshot_type: 'source',
			file_path: tarPath,
			file_size: tarball.length,
			sha256: 'legacy-source',
			head_sha: 'legacy-head',
			archived_at: now
		});

		const result = await ensureZipForLatestSource(repo, 'export');
		expect(result).toBe('saved');
		expect(getLatestArchiveSnapshot(repo.id, 'zip')).toBeTruthy();
		expect(getRepoZipDownloadUrl(repo.owner, repo.name, repo.id)).toMatch(/^\/api\/snapshots\/\d+$/);
	});
});
