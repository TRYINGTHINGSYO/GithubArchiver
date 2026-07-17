import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { markDatabaseReady, resetDatabaseReadyForTests } from './ready';
import { repairSchemaDrift, runMigrations } from './schema';

export function getDatabasePath(): string {
	return process.env.DATABASE_PATH ?? './data/githubarchive.db';
}

/** @deprecated Use getDatabasePath() — path is resolved at call time. */
export const DB_PATH = getDatabasePath();

let db: Database.Database | null = null;
let dbPathOpened: string | null = null;

export function getDb(): Database.Database {
	const path = getDatabasePath();
	if (db && dbPathOpened !== path) {
		db.close();
		db = null;
		dbPathOpened = null;
		resetDatabaseReadyForTests();
	}
	if (!db) {
		mkdirSync(dirname(path), { recursive: true });
		db = new Database(path);
		dbPathOpened = path;
		db.pragma('journal_mode = WAL');
		db.pragma('foreign_keys = ON');
		db.pragma('busy_timeout = 5000');
		runMigrations(db);
		repairSchemaDrift(db);
		markDatabaseReady();
	}
	return db;
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
		dbPathOpened = null;
		resetDatabaseReadyForTests();
	}
}

/** Ensure the configured DB is opened, migrated, drift-repaired, and marked ready. */
export function ensureDatabaseReady(): void {
	getDb();
}
