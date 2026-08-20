import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { CURRENT_SCHEMA_VERSION, runMigrationsThrough } from '$lib/server/db/schema';

describe('migration 048 semantic reconcile cursor', () => {
	it('creates semantic_reconcile_cursor and status/vector index', () => {
		const db = new Database(':memory:');
		try {
			const result = runMigrationsThrough(db, CURRENT_SCHEMA_VERSION);
			expect(CURRENT_SCHEMA_VERSION).toBe(48);
			expect(result.after).toBe(48);
			expect(result.applied).toContain(48);

			const tables = (
				db
					.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
					.all() as { name: string }[]
			).map((r) => r.name);
			expect(tables).toContain('semantic_reconcile_cursor');

			const indexes = (
				db
					.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
					.all() as { name: string }[]
			).map((r) => r.name);
			expect(indexes).toContain('idx_semantic_index_type_status_vector');
		} finally {
			db.close();
		}
	});
});
