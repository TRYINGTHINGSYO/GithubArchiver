import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '$lib/server/db/connection';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/db/schema';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('migration011', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('applies schema version 11 with ops intelligence columns', () => {
		const db = getDb();
		const version = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;
		expect(version).toBe(CURRENT_SCHEMA_VERSION);
		expect(CURRENT_SCHEMA_VERSION).toBe(27);

		const jobCols = (db.prepare('PRAGMA table_info(job_runs)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(jobCols).toContain('reason');

		const repoCols = (db.prepare('PRAGMA table_info(repos)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(repoCols).toContain('summary');
		expect(repoCols).toContain('category');

		const tables = (
			db
				.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?)`)
				.all('daemon_decisions', 'repo_category_daily', 'repo_favorites') as { name: string }[]
		).map((r) => r.name);
		expect(tables).toContain('daemon_decisions');
		expect(tables).toContain('repo_category_daily');
		expect(tables).toContain('repo_favorites');

		const ingestCols = (db.prepare('PRAGMA table_info(ingestion_state)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(ingestCols).toContain('unavailable_at');
		expect(ingestCols).toContain('http_status');
	});
});
