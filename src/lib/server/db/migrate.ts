import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getDatabasePath } from './connection';
import { markDatabaseReady } from './ready';
import {
	CURRENT_SCHEMA_VERSION,
	getSchemaVersion,
	hasRepoColumn,
	repairSchemaDrift,
	runMigrations,
	type MigrationRunResult
} from './schema';

/** Safe for logs — never includes env secrets, only the resolved filesystem path. */
export function sanitizeDatabasePath(path: string): string {
	return path.replace(/\\/g, '/');
}

export interface DatabaseStatus {
	path: string;
	sanitizedPath: string;
	currentSchemaVersion: number;
	expectedSchemaVersion: number;
	interestingScoreExists: boolean;
	repositoryCount: number;
	upToDate: boolean;
}

export function readDatabaseStatus(database: Database.Database, path = getDatabasePath()): DatabaseStatus {
	const currentSchemaVersion = getSchemaVersion(database);
	const interestingScoreExists = hasRepoColumn(database, 'interesting_score');
	let repositoryCount = 0;
	try {
		repositoryCount = (database.prepare('SELECT COUNT(*) as c FROM repos').get() as { c: number }).c;
	} catch {
		repositoryCount = 0;
	}
	return {
		path,
		sanitizedPath: sanitizeDatabasePath(path),
		currentSchemaVersion,
		expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
		interestingScoreExists,
		repositoryCount,
		upToDate:
			currentSchemaVersion === CURRENT_SCHEMA_VERSION &&
			interestingScoreExists &&
			currentSchemaVersion >= 14
	};
}

export interface MigrateDatabaseResult extends MigrationRunResult {
	path: string;
	sanitizedPath: string;
	repairs: string[];
	status: DatabaseStatus;
}

/**
 * Open the configured production database, apply every missing migration in order,
 * repair known schema drift, and verify intelligence columns exist.
 */
export function migrateDatabase(opts: { path?: string; database?: Database.Database } = {}): MigrateDatabaseResult {
	const path = opts.path ?? getDatabasePath();
	const ownsConnection = !opts.database;
	mkdirSync(dirname(path), { recursive: true });

	const database =
		opts.database ??
		(() => {
			const db = new Database(path);
			db.pragma('journal_mode = WAL');
			db.pragma('foreign_keys = ON');
			return db;
		})();

	try {
		const migration = runMigrations(database);
		const repairs = repairSchemaDrift(database);
		const status = readDatabaseStatus(database, path);

		if (status.currentSchemaVersion !== CURRENT_SCHEMA_VERSION) {
			throw new Error(
				`Migration finished at schema ${status.currentSchemaVersion}, expected ${CURRENT_SCHEMA_VERSION}`
			);
		}
		if (!status.interestingScoreExists) {
			throw new Error('Migration finished but repos.interesting_score is still missing');
		}

		markDatabaseReady();
		return {
			path,
			sanitizedPath: sanitizeDatabasePath(path),
			...migration,
			repairs,
			status
		};
	} finally {
		if (ownsConnection) {
			database.close();
		}
	}
}

export function logMigrationResult(result: MigrateDatabaseResult): void {
	console.log(`Database path: ${result.sanitizedPath}`);
	console.log(`Schema before migration: ${result.before}`);
	console.log(
		`Applied migrations: ${
			result.applied.length === 0 ? 'none (already current)' : result.applied.join(', ')
		}`
	);
	if (result.repairs.length > 0) {
		console.log(`Schema drift repairs: ${result.repairs.join(', ')}`);
	}
	console.log(`Schema after migration: ${result.after}`);
}
