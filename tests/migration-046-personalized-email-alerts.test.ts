import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, runMigrationsThrough } from '$lib/server/db/schema';

describe('migration 046 personalized email alerts', () => {
	it('adds opt-in preferences and deduplicated delivery history', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		try {
			runMigrationsThrough(db, 45);
			expect(
				db
					.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_email_preferences'")
					.get()
			).toBeUndefined();

			const result = runMigrationsThrough(db, CURRENT_SCHEMA_VERSION);
			expect(CURRENT_SCHEMA_VERSION).toBe(48);
			expect(result.applied).toEqual([46, 47]);

			const tables = (
				db
					.prepare(
						"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user_email_preferences', 'personalized_email_deliveries', 'semantic_index_state')"
					)
					.all() as Array<{ name: string }>
			).map((row) => row.name);
			expect(tables.sort()).toEqual(
				[
					'personalized_email_deliveries',
					'semantic_index_state',
					'user_email_preferences'
				].sort()
			);

			const deliveryIndexes = db
				.prepare('PRAGMA index_list(personalized_email_deliveries)')
				.all() as Array<{ unique: number }>;
			expect(deliveryIndexes.some((index) => index.unique === 1)).toBe(true);
		} finally {
			db.close();
		}
	});
});
