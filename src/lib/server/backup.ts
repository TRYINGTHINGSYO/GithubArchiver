import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, relative, resolve } from 'node:path';
import { getDb, DB_PATH } from './db/connection';
import { CURRENT_SCHEMA_VERSION } from './db/schema';
import {
	countArchiveSnapshotFiles,
	countIngestedHours,
	countRepos,
	sumArchiveSnapshotBytes
} from './db';

export const BACKUPS_DIR = process.env.BACKUPS_DIR ?? './data/backups';

export type BackupType = 'manifest-only' | 'full';

export interface BackupResult {
	dir: string;
	dirName: string;
	createdAt: string;
	totalBytes: number;
	backupType: BackupType;
	compressed: boolean;
	includeArchives: boolean;
}

export interface BackupSummary {
	latest: {
		dirName: string;
		createdAt: string | null;
		totalBytes: number;
		backupType: BackupType;
		compressed: boolean;
	} | null;
	backupCount: number;
}

export interface BackupOptions {
	includeArchives?: boolean;
	compress?: boolean;
}

interface ManifestFile {
	relative_path: string;
	size: number;
	modified_at: string;
}

interface ArchivesManifest {
	archive_dir: string;
	generated_at: string;
	total_files: number;
	total_bytes: number;
	files: ManifestFile[];
	snapshots: {
		id: number;
		repo_id: number;
		full_name: string;
		snapshot_type: string;
		file_path: string;
		file_size: number;
		sha256: string;
		head_sha: string | null;
		archived_at: string;
		file_exists: boolean;
	}[];
}

interface BackupMetadata {
	backup_created_at: string;
	backup_dir: string;
	backup_type: BackupType;
	include_archives: boolean;
	compressed: boolean;
	source: {
		database_path: string;
		archive_dir: string;
	};
	schema_version: number;
	stats: Record<string, number>;
	files: Record<string, string>;
	total_bytes: number;
}

function envFlag(name: string): boolean {
	const value = process.env[name];
	return value === '1' || value === 'true';
}

function resolveBackupOptions(opts: BackupOptions = {}): Required<BackupOptions> {
	return {
		includeArchives: opts.includeArchives ?? envFlag('BACKUP_INCLUDE_ARCHIVES'),
		compress: opts.compress ?? envFlag('BACKUP_COMPRESS')
	};
}

function formatBackupDirName(date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function dirSize(root: string): number {
	let total = 0;
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const full = join(root, entry.name);
		if (entry.isDirectory()) {
			total += dirSize(full);
		} else if (entry.isFile()) {
			total += statSync(full).size;
		}
	}
	return total;
}

function walkArchiveFiles(archiveDir: string): ManifestFile[] {
	if (!existsSync(archiveDir)) return [];

	const files: ManifestFile[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile()) {
				const st = statSync(full);
				files.push({
					relative_path: relative(archiveDir, full).replace(/\\/g, '/'),
					size: st.size,
					modified_at: st.mtime.toISOString()
				});
			}
		}
	};
	walk(archiveDir);
	files.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
	return files;
}

function buildArchivesManifest(archiveDir: string): ArchivesManifest {
	const db = getDb();
	const files = walkArchiveFiles(archiveDir);
	const snapshots = db
		.prepare(
			`SELECT a.id, a.repo_id, r.full_name, a.snapshot_type, a.file_path,
			        a.file_size, a.sha256, a.head_sha, a.archived_at
			 FROM archive_snapshots a
			 JOIN repos r ON r.id = a.repo_id
			 ORDER BY a.id`
		)
		.all() as {
		id: number;
		repo_id: number;
		full_name: string;
		snapshot_type: string;
		file_path: string;
		file_size: number;
		sha256: string;
		head_sha: string | null;
		archived_at: string;
	}[];

	return {
		archive_dir: archiveDir,
		generated_at: new Date().toISOString(),
		total_files: files.length,
		total_bytes: files.reduce((sum, f) => sum + f.size, 0),
		files,
		snapshots: snapshots.map((row) => ({
			...row,
			file_exists: existsSync(row.file_path)
		}))
	};
}

function copyArchiveTree(sourceDir: string, destDir: string): void {
	if (!existsSync(sourceDir)) return;
	mkdirSync(destDir, { recursive: true });
	cpSync(sourceDir, destDir, { recursive: true });
}

function buildMetadata(opts: {
	dirName: string;
	destDir: string;
	dbPath: string;
	archiveDir: string;
	manifest: ArchivesManifest;
	dbFileName: string;
	backupType: BackupType;
	includeArchives: boolean;
	compressed: boolean;
}): BackupMetadata {
	const files: Record<string, string> = {
		database: opts.dbFileName,
		archives_manifest: 'archives-manifest.json',
		metadata: 'metadata.json'
	};
	if (opts.includeArchives) {
		files.archives = 'archives/';
	}

	const metadata: BackupMetadata = {
		backup_created_at: new Date().toISOString(),
		backup_dir: opts.dirName,
		backup_type: opts.backupType,
		include_archives: opts.includeArchives,
		compressed: opts.compressed,
		source: {
			database_path: opts.dbPath,
			archive_dir: opts.archiveDir
		},
		schema_version: CURRENT_SCHEMA_VERSION,
		stats: {
			repos: countRepos(),
			archive_snapshots: countArchiveSnapshotFiles(),
			ingested_hours: countIngestedHours(),
			indexed_archive_bytes: sumArchiveSnapshotBytes(),
			archive_files_on_disk: opts.manifest.total_files,
			archive_bytes_on_disk: opts.manifest.total_bytes
		},
		files,
		total_bytes: dirSize(opts.destDir)
	};

	return metadata;
}

function writeSidecar(backupsRoot: string, dirName: string, metadata: BackupMetadata, archiveFile: string): void {
	const sidecar = {
		backup_created_at: metadata.backup_created_at,
		backup_dir: dirName,
		backup_type: metadata.backup_type,
		include_archives: metadata.include_archives,
		compressed: true,
		archive_file: archiveFile,
		total_bytes: statSync(join(backupsRoot, archiveFile)).size
	};
	writeFileSync(join(backupsRoot, `${dirName}.meta.json`), JSON.stringify(sidecar, null, 2));
}

function compressBackupDir(backupsRoot: string, dirName: string, metadata: BackupMetadata): string {
	const archiveFile = `${dirName}.tar.gz`;
	const archivePath = join(backupsRoot, archiveFile);
	const result = spawnSync('tar', ['-czf', archivePath, '-C', backupsRoot, dirName], {
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(`tar compression failed: ${result.stderr || result.stdout || 'unknown error'}`);
	}

	writeSidecar(backupsRoot, dirName, metadata, archiveFile);
	rmSync(join(backupsRoot, dirName), { recursive: true, force: true });
	return archivePath;
}

function readMetadataAtPath(metaPath: string): Partial<BackupMetadata> | null {
	if (!existsSync(metaPath)) return null;
	try {
		return JSON.parse(readFileSync(metaPath, 'utf8')) as Partial<BackupMetadata>;
	} catch {
		return null;
	}
}

function listBackupEntries(backupsRoot: string): { dirName: string; mtime: number }[] {
	if (!existsSync(backupsRoot)) return [];

	const entries = new Map<string, number>();

	for (const name of readdirSync(backupsRoot)) {
		if (name.endsWith('.meta.json')) continue;

		const full = join(backupsRoot, name);
		const st = statSync(full);

		if (name.endsWith('.tar.gz')) {
			const dirName = name.slice(0, -'.tar.gz'.length);
			entries.set(dirName, Math.max(entries.get(dirName) ?? 0, st.mtimeMs));
			continue;
		}

		if (st.isDirectory()) {
			entries.set(name, Math.max(entries.get(name) ?? 0, st.mtimeMs));
		}
	}

	return [...entries.entries()]
		.map(([dirName, mtime]) => ({ dirName, mtime }))
		.sort((a, b) => b.mtime - a.mtime);
}

function readBackupEntrySummary(backupsRoot: string, dirName: string): BackupSummary['latest'] {
	const dirPath = join(backupsRoot, dirName);
	const metaPath = join(dirPath, 'metadata.json');
	const sidecarPath = join(backupsRoot, `${dirName}.meta.json`);
	const archivePath = join(backupsRoot, `${dirName}.tar.gz`);

	const folderMeta = readMetadataAtPath(metaPath);
	const sidecarMeta = readMetadataAtPath(sidecarPath);
	const meta = sidecarMeta ?? folderMeta;

	const compressed = existsSync(archivePath) || meta?.compressed === true;
	let totalBytes = 0;

	if (compressed && existsSync(archivePath)) {
		totalBytes = statSync(archivePath).size;
	} else if (existsSync(dirPath)) {
		totalBytes = dirSize(dirPath);
	}

	if (meta) {
		return {
			dirName,
			createdAt: meta.backup_created_at ?? null,
			totalBytes: typeof meta.total_bytes === 'number' ? meta.total_bytes : totalBytes,
			backupType: meta.backup_type ?? (meta.include_archives ? 'full' : 'manifest-only'),
			compressed
		};
	}

	return {
		dirName,
		createdAt: null,
		totalBytes,
		backupType: 'manifest-only',
		compressed
	};
}

async function backupDatabase(destPath: string): Promise<void> {
	const db = getDb();
	await db.backup(destPath);
}

export async function runBackup(opts: BackupOptions = {}): Promise<BackupResult> {
	const { includeArchives, compress } = resolveBackupOptions(opts);
	const dbPath = resolve(DB_PATH);
	const archiveDir = resolve(process.env.ARCHIVE_DIR ?? './data/archives');
	const backupsRoot = resolve(BACKUPS_DIR);
	const dirName = formatBackupDirName();
	const destDir = join(backupsRoot, dirName);
	const backupType: BackupType = includeArchives ? 'full' : 'manifest-only';

	mkdirSync(destDir, { recursive: true });

	const dbFileName = basename(dbPath);
	const dbDest = join(destDir, dbFileName);

	await backupDatabase(dbDest);

	const manifest = buildArchivesManifest(archiveDir);
	writeFileSync(join(destDir, 'archives-manifest.json'), JSON.stringify(manifest, null, 2));

	if (includeArchives) {
		copyArchiveTree(archiveDir, join(destDir, 'archives'));
	}

	let metadata = buildMetadata({
		dirName,
		destDir,
		dbPath,
		archiveDir,
		manifest,
		dbFileName,
		backupType,
		includeArchives,
		compressed: compress
	});
	writeFileSync(join(destDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

	let resultPath = destDir;
	if (compress) {
		resultPath = compressBackupDir(backupsRoot, dirName, metadata);
		metadata = {
			...metadata,
			compressed: true,
			total_bytes: statSync(resultPath).size
		};
	} else {
		metadata = { ...metadata, total_bytes: dirSize(destDir) };
		writeFileSync(join(destDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
	}

	return {
		dir: resultPath,
		dirName,
		createdAt: metadata.backup_created_at,
		totalBytes: metadata.total_bytes,
		backupType,
		compressed: compress,
		includeArchives
	};
}

export function getBackupSummary(): BackupSummary {
	const backupsRoot = resolve(BACKUPS_DIR);
	const entries = listBackupEntries(backupsRoot);

	if (entries.length === 0) {
		return { latest: null, backupCount: 0 };
	}

	return {
		latest: readBackupEntrySummary(backupsRoot, entries[0].dirName),
		backupCount: entries.length
	};
}
