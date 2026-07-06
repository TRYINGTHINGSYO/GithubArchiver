import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync
} from 'node:fs';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { closeDb, getDatabasePath } from './db/connection';
import { getLatestDaemonJob, parseJobDetail } from './db/jobs';
import { runBackup, type BackupResult, type BackupType } from './backup';

const DEV_PORT = Number(process.env.PORT ?? 5173);

export interface RestoreResult {
	restoredFrom: string;
	backupType: BackupType;
	preRestoreBackup: BackupResult;
	archivesRestored: boolean;
	databasePath: string;
}

export interface RestoreOptions {
	backupPath: string;
	confirm?: boolean;
}

interface BackupMetadata {
	backup_type?: BackupType;
	include_archives?: boolean;
	files?: { database?: string };
}

interface ResolvedBackup {
	dir: string;
	cleanup: () => void;
	compressed: boolean;
}

function envFlag(name: string): boolean {
	const value = process.env[name];
	return value === '1' || value === 'true';
}

function readBackupMetadata(backupDir: string): BackupMetadata | null {
	const metaPath = join(backupDir, 'metadata.json');
	if (!existsSync(metaPath)) return null;
	try {
		return JSON.parse(readFileSync(metaPath, 'utf8')) as BackupMetadata;
	} catch {
		return null;
	}
}

function findDatabaseFile(backupDir: string): string {
	const metadata = readBackupMetadata(backupDir);
	const preferred = metadata?.files?.database ?? basename(getDatabasePath());
	const named = join(backupDir, preferred);
	if (existsSync(named) && statSync(named).isFile()) return named;

	const fallback = join(backupDir, basename(getDatabasePath()));
	if (existsSync(fallback) && statSync(fallback).isFile()) return fallback;

	for (const name of ['githubarchive.db']) {
		const candidate = join(backupDir, name);
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}

	throw new Error(`No database file found in backup: ${backupDir}`);
}

function resolveBackupContents(backupPath: string): ResolvedBackup {
	const resolved = resolve(backupPath);
	if (!existsSync(resolved)) {
		throw new Error(`Backup path does not exist: ${resolved}`);
	}

	const stat = statSync(resolved);
	if (stat.isDirectory()) {
		return { dir: resolved, cleanup: () => {}, compressed: false };
	}

	if (!resolved.endsWith('.tar.gz')) {
		throw new Error(`Backup path must be a folder or .tar.gz file: ${resolved}`);
	}

	const extractDir = join(dirname(resolved), `_restore_${Date.now()}`);
	mkdirSync(extractDir, { recursive: true });

	const result = spawnSync('tar', ['-xzf', resolved, '-C', extractDir], { encoding: 'utf8' });
	if (result.status !== 0) {
		rmSync(extractDir, { recursive: true, force: true });
		throw new Error(`tar extract failed: ${result.stderr || result.stdout || 'unknown error'}`);
	}

	const entries = readdirSync(extractDir);
	if (entries.length === 1 && statSync(join(extractDir, entries[0])).isDirectory()) {
		return {
			dir: join(extractDir, entries[0]),
			cleanup: () => rmSync(extractDir, { recursive: true, force: true }),
			compressed: true
		};
	}

	return {
		dir: extractDir,
		cleanup: () => rmSync(extractDir, { recursive: true, force: true }),
		compressed: true
	};
}

async function isPortInUse(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once('error', () => resolve(true));
		server.once('listening', () => {
			server.close(() => resolve(false));
		});
		server.listen(port);
	});
}

function detectDaemonRunning(): boolean {
	const daemon = getLatestDaemonJob();
	if (!daemon || daemon.status !== 'running') return false;

	const detail = parseJobDetail(daemon);
	const started = new Date(daemon.started_at).getTime();
	const recent = Date.now() - started < 30 * 60 * 1000;
	return recent && Boolean(detail?.pid);
}

async function collectServiceWarnings(): Promise<string[]> {
	const warnings: string[] = [];

	if (await isPortInUse(DEV_PORT)) {
		warnings.push(`Dev server appears to be running on port ${DEV_PORT} (npm run dev).`);
	}

	if (detectDaemonRunning()) {
		warnings.push('Daemon appears to be running (npm run daemon).');
	}

	return warnings;
}

function removeWalFiles(dbPath: string): void {
	for (const suffix of ['-wal', '-shm']) {
		const walPath = `${dbPath}${suffix}`;
		if (existsSync(walPath)) {
			rmSync(walPath, { force: true });
		}
	}
}

function restoreDatabase(backupDbPath: string, liveDbPath: string): void {
	mkdirSync(dirname(liveDbPath), { recursive: true });
	cpSync(backupDbPath, liveDbPath, { force: true });
	removeWalFiles(liveDbPath);
}

function restoreArchivesIfPresent(backupDir: string): boolean {
	const archivesSrc = join(backupDir, 'archives');
	if (!existsSync(archivesSrc) || !statSync(archivesSrc).isDirectory()) {
		return false;
	}

	const archiveDir = resolve(process.env.ARCHIVE_DIR ?? './data/archives');
	if (existsSync(archiveDir)) {
		rmSync(archiveDir, { recursive: true, force: true });
	}
	mkdirSync(dirname(archiveDir), { recursive: true });
	cpSync(archivesSrc, archiveDir, { recursive: true });
	return true;
}

function runDbInit(): void {
	const result = spawnSync('npm', ['run', 'db:init'], {
		cwd: resolve('.'),
		stdio: 'inherit',
		shell: true
	});
	if (result.status !== 0) {
		throw new Error('npm run db:init failed after restore');
	}
}

function inferBackupType(backupDir: string): BackupType {
	const metadata = readBackupMetadata(backupDir);
	if (metadata?.backup_type) return metadata.backup_type;
	if (metadata?.include_archives) return 'full';
	if (existsSync(join(backupDir, 'archives'))) return 'full';
	return 'manifest-only';
}

export async function runRestore(opts: RestoreOptions): Promise<RestoreResult> {
	const backupPath = opts.backupPath || process.env.RESTORE_BACKUP_PATH;
	if (!backupPath) {
		throw new Error('RESTORE_BACKUP_PATH is required (path to backup folder or .tar.gz)');
	}

	const confirmed = opts.confirm ?? envFlag('RESTORE_CONFIRM');
	if (!confirmed) {
		console.error('');
		console.error('WARNING: Restore replaces the live database (and archives if present in backup).');
		console.error('Stop the daemon (npm run daemon) and dev server (npm run dev) before restoring.');
		console.error('');
		console.error('Set RESTORE_CONFIRM=1 to proceed.');
		console.error('');
		process.exit(1);
	}

	const serviceWarnings = await collectServiceWarnings();
	if (serviceWarnings.length > 0) {
		console.warn('');
		console.warn('WARNING: Active services detected:');
		for (const warning of serviceWarnings) {
			console.warn(`  - ${warning}`);
		}
		console.warn('Restore may fail or corrupt data if services keep the database open.');
		console.warn('');
	}

	const resolved = resolveBackupContents(backupPath);

	try {
		const backupDbPath = findDatabaseFile(resolved.dir);
		const backupType = inferBackupType(resolved.dir);
		const liveDbPath = resolve(getDatabasePath());

		console.log('Creating pre-restore backup of current state...');
		const preRestoreBackup = await runBackup();
		console.log(`  Pre-restore backup: ${preRestoreBackup.dir}`);

		closeDb();

		console.log(`Restoring database from ${backupDbPath}...`);
		restoreDatabase(backupDbPath, liveDbPath);

		let archivesRestored = false;
		if (existsSync(join(resolved.dir, 'archives'))) {
			console.log('Restoring archives/ from backup...');
			archivesRestored = restoreArchivesIfPresent(resolved.dir);
		} else {
			console.log('No archives/ in backup — skipping archive file restore.');
		}

		console.log('Running npm run db:init...');
		runDbInit();

		return {
			restoredFrom: resolve(backupPath),
			backupType,
			preRestoreBackup,
			archivesRestored,
			databasePath: liveDbPath
		};
	} finally {
		resolved.cleanup();
	}
}
