import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
	CURRENT_SCHEMA_VERSION,
	getSchemaVersion,
	repairSchemaDrift,
	runMigrations,
	runMigrationsThrough
} from '$lib/server/db/schema';

function objectNames(db: Database.Database, type: 'table' | 'index'): string[] {
	return (
		db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type) as Array<{ name: string }>
	).map((row) => row.name);
}

describe('migration 41 owner collections', () => {
	it('creates the collection schema and enforces one system kind per owner', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		runMigrations(db);

		expect(CURRENT_SCHEMA_VERSION).toBe(44);
		expect(getSchemaVersion(db)).toBe(44);
		expect(objectNames(db, 'table')).toEqual(
			expect.arrayContaining(['collections', 'collection_repositories', 'repo_favorites'])
		);
		expect(
			(db.prepare('PRAGMA table_info(collections)').all() as Array<{ name: string }>).map(
				(column) => column.name
			)
		).toEqual([
			'id',
			'owner_type',
			'owner_key',
			'kind',
			'name',
			'slug',
			'created_at',
			'updated_at'
		]);
		expect(
			(db.prepare('PRAGMA table_info(collection_repositories)').all() as Array<{ name: string }>).map(
				(column) => column.name
			)
		).toEqual(['collection_id', 'repo_id', 'created_at']);
		expect(objectNames(db, 'index')).toEqual(
			expect.arrayContaining([
				'idx_collections_owner_slug',
				'idx_collections_system_kind',
				'idx_collection_repositories_repo'
			])
		);

		const insert = db.prepare(
			`INSERT INTO collections
			 (owner_type, owner_key, kind, name, slug, created_at, updated_at)
			 VALUES ('anonymous', 'anon:test', ?, ?, ?, 'now', 'now')`
		);
		insert.run('favorites', 'Favorites', 'favorites');
		expect(() => insert.run('favorites', 'Other Favorites', 'other-favorites')).toThrow();
		insert.run('watch_later', 'Watch Later', 'watch-later');
		db.close();
	});

	it('repairs schema-41 drift when the version exists without its DDL', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		runMigrationsThrough(db, 40);
		db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (41, ?)').run(
			new Date().toISOString()
		);

		expect(objectNames(db, 'table')).not.toContain('collections');
		expect(repairSchemaDrift(db)).toContain('041:owner_collections');
		expect(objectNames(db, 'table')).toEqual(
			expect.arrayContaining(['collections', 'collection_repositories'])
		);
		expect(repairSchemaDrift(db)).not.toContain('041:owner_collections');
		db.close();
	});
});
