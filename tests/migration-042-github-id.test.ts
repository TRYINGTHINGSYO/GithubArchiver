import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
	CURRENT_SCHEMA_VERSION,
	getSchemaVersion,
	repairSchemaDrift,
	runMigrations,
	runMigrationsThrough
} from '$lib/server/db/schema';

describe('migration 042 github_id', () => {
	it('adds github_id and unique indexes on a fresh database', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		runMigrations(db);

		expect(CURRENT_SCHEMA_VERSION).toBe(43);
		expect(getSchemaVersion(db)).toBe(43);
		const cols = (
			db.prepare('PRAGMA table_info(repos)').all() as Array<{ name: string }>
		).map((row) => row.name);
		expect(cols).toContain('github_id');

		const indexes = (
			db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as Array<{
				name: string;
			}>
		).map((row) => row.name);
		expect(indexes).toEqual(
			expect.arrayContaining(['repos_github_id_unique', 'repos_owner_name_unique'])
		);
		db.close();
	});

	it('repairs schema-42 drift when version exists without github_id', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		runMigrationsThrough(db, 41);
		db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (42, ?)').run(
			new Date().toISOString()
		);

		expect(
			(db.prepare('PRAGMA table_info(repos)').all() as Array<{ name: string }>).map(
				(row) => row.name
			)
		).not.toContain('github_id');

		expect(repairSchemaDrift(db)).toContain('042:repos_github_id');
		expect(
			(db.prepare('PRAGMA table_info(repos)').all() as Array<{ name: string }>).map(
				(row) => row.name
			)
		).toContain('github_id');
		expect(repairSchemaDrift(db)).not.toContain('042:repos_github_id');
		db.close();
	});
});
