import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, runMigrationsThrough } from '$lib/server/db/schema';

describe('migration 047 semantic index state', () => {
	it('creates semantic_index_state with lifecycle columns', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		try {
			runMigrationsThrough(db, 46);
			expect(
				db
					.prepare(
						"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'semantic_index_state'"
					)
					.get()
			).toBeUndefined();

			const result = runMigrationsThrough(db, CURRENT_SCHEMA_VERSION);
			expect(CURRENT_SCHEMA_VERSION).toBe(48);
			expect(result.applied).toEqual([47, 48]);

			const cols = (
				db.prepare('PRAGMA table_info(semantic_index_state)').all() as Array<{ name: string }>
			).map((c) => c.name);
			expect(cols).toEqual(
				expect.arrayContaining([
					'entity_type',
					'entity_key',
					'vector_id',
					'status',
					'fingerprint',
					'embedding_model',
					'document_version'
				])
			);
		} finally {
			db.close();
		}
	});
});
