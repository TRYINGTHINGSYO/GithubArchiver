import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { clearTtlCache } from '$lib/server/ttl-cache';
import { markDatabaseReady, resetDatabaseReadyForTests } from './ready';
import { repairSchemaDrift, runMigrations } from './schema';

export function getDatabasePath(): string {
	return process.env.DATABASE_PATH ?? './data/githubarchive.db';
}

/** @deprecated Use getDatabasePath() — path is resolved at call time. */
export const DB_PATH = getDatabasePath();

let db: Database.Database | null = null;
let dbPathOpened: string | null = null;

function releaseDbHandle(): void {
	if (db) {
		db.close();
		db = null;
		dbPathOpened = null;
		resetDatabaseReadyForTests();
	}
	// Process-local aggregates must not outlive the SQLite file they were computed from.
	clearTtlCache();
}

export function getDb(): Database.Database {
	const path = getDatabasePath();
	if (db && dbPathOpened !== path) {
		releaseDbHandle();
	}
	if (!db) {
		mkdirSync(dirname(path), { recursive: true });
		db = new Database(path);
		dbPathOpened = path;
		db.pragma('journal_mode = WAL');
		// FULL fsyncs every commit. With WAL, NORMAL is crash-safe for the DB file
		// and is the difference between ~5 fsyncs/create and one fsync/hour when
		// ingest commits a batch. The volume is network-attached, so the default
		// was the dominant cost of each repository create.
		db.pragma('synchronous = NORMAL');
		db.pragma('foreign_keys = ON');
		db.pragma('busy_timeout = 5000');
		runMigrations(db);
		repairSchemaDrift(db);
		markDatabaseReady();
		// Opening a new handle (fresh volume, path swap, or tests) starts with a cold cache.
		clearTtlCache();
	}
	return db;
}

export function closeDb(): void {
	releaseDbHandle();
}

/** Ensure the configured DB is opened, migrated, drift-repaired, and marked ready. */
export function ensureDatabaseReady(): void {
	getDb();
}
