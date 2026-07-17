#!/usr/bin/env node
import './load-env.js';
import Database from 'better-sqlite3';
import { getDatabasePath } from '../src/lib/server/db/connection.js';
import { readDatabaseStatus, sanitizeDatabasePath } from '../src/lib/server/db/migrate.js';

const path = getDatabasePath();

try {
	const db = new Database(path, { readonly: true, fileMustExist: true });
	try {
		const status = readDatabaseStatus(db, path);
		console.log(`Database path: ${status.sanitizedPath}`);
		console.log(`Current schema version: ${status.currentSchemaVersion}`);
		console.log(`Expected schema version: ${status.expectedSchemaVersion}`);
		console.log(`repos.interesting_score: ${status.interestingScoreExists ? 'yes' : 'no'}`);
		console.log(`Repository count: ${status.repositoryCount.toLocaleString()}`);
		console.log(`Up to date: ${status.upToDate ? 'yes' : 'no'}`);
		process.exitCode = status.upToDate ? 0 : 2;
	} finally {
		db.close();
	}
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Database status failed: ${message}`);
	console.error(`Database path: ${sanitizeDatabasePath(path)}`);
	process.exitCode = 1;
}
