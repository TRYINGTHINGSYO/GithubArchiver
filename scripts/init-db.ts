#!/usr/bin/env node
import './load-env.js';
import { logMigrationResult, migrateDatabase } from '../src/lib/server/db/migrate.js';

const result = migrateDatabase();
logMigrationResult(result);
console.log('Database initialized at', result.sanitizedPath);
