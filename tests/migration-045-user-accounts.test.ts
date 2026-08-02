import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, runMigrationsThrough } from '$lib/server/db/schema';

describe('migration 045 user accounts', () => {
	it('upgrades schema 44 without changing earlier migration history', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		try {
			runMigrationsThrough(db, 44);
			expect(
				db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()
			).toBeUndefined();

			const result = runMigrationsThrough(db, 45);
			expect(CURRENT_SCHEMA_VERSION).toBe(46);
			expect(result.applied).toEqual([45]);

			const tables = (
				db
					.prepare(
						"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'oauth_accounts', 'user_sessions', 'user_saved_repos')"
					)
					.all() as Array<{ name: string }>
			).map((row) => row.name);
			expect(tables.sort()).toEqual(
				['oauth_accounts', 'user_saved_repos', 'user_sessions', 'users'].sort()
			);

			const savedRepoForeignKeys = db.prepare('PRAGMA foreign_key_list(user_saved_repos)').all() as Array<{
				table: string;
				from: string;
			}>;
			expect(savedRepoForeignKeys).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ table: 'repos', from: 'repo_id' }),
					expect.objectContaining({ table: 'users', from: 'user_id' })
				])
			);
		} finally {
			db.close();
		}
	});
});
