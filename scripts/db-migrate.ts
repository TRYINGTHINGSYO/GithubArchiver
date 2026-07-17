#!/usr/bin/env node
import './load-env.js';
import { logMigrationResult, migrateDatabase } from '../src/lib/server/db/migrate.js';

try {
	const result = migrateDatabase();
	logMigrationResult(result);
	console.log(`Repository count: ${result.status.repositoryCount.toLocaleString()}`);
	console.log(`repos.interesting_score: ${result.status.interestingScoreExists ? 'present' : 'MISSING'}`);
	process.exitCode = 0;
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Database migration failed: ${message}`);
	process.exitCode = 1;
}
