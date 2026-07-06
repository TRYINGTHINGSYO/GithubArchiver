import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runMigrations } from './schema';

export const DB_PATH = process.env.DATABASE_PATH ?? './data/githubarchive.db';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
	if (!db) {
		mkdirSync(dirname(DB_PATH), { recursive: true });
		db = new Database(DB_PATH);
		db.pragma('journal_mode = WAL');
		db.pragma('foreign_keys = ON');
		runMigrations(db);
	}
	return db;
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}
