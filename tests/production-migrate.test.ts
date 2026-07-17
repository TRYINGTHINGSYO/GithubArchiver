import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '$lib/server/db/connection';
import { ensureClusterRegistry } from '$lib/server/db/clusters';
import { migrateDatabase } from '$lib/server/db/migrate';
import {
	CURRENT_SCHEMA_VERSION,
	getSchemaVersion,
	hasRepoColumn,
	runMigrationsThrough
} from '$lib/server/db/schema';
import { getActiveQualityClusters, getDiscoveryLanding } from '$lib/server/discovery';

describe('production migration entry point from pre-014 schema', () => {
	let tmpDir: string | null = null;
	let previousPath: string | undefined;

	afterEach(() => {
		closeDb();
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
			tmpDir = null;
		}
		if (previousPath === undefined) delete process.env.DATABASE_PATH;
		else process.env.DATABASE_PATH = previousPath;
	});

	it('migrates a populated schema-13 database to current and preserves repos', () => {
		previousPath = process.env.DATABASE_PATH;
		tmpDir = mkdtempSync(join(tmpdir(), 'githubarchive-migrate-'));
		const dbPath = join(tmpDir, 'legacy.db');
		process.env.DATABASE_PATH = dbPath;

		const legacy = new Database(dbPath);
		legacy.pragma('journal_mode = WAL');
		legacy.pragma('foreign_keys = ON');
		const through13 = runMigrationsThrough(legacy, 13);
		expect(through13.after).toBe(13);
		expect(hasRepoColumn(legacy, 'interesting_score')).toBe(false);

		legacy
			.prepare(
				`INSERT INTO repos (
					owner, name, full_name, github_url, event_id, created_at, first_seen_at,
					description, language, stars
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				'acme',
				'legacy-widget',
				'acme/legacy-widget',
				'https://github.com/acme/legacy-widget',
				'evt-legacy-1',
				'2026-06-01T00:00:00.000Z',
				'2026-06-01T00:00:00.000Z',
				'A preserved legacy repository',
				'TypeScript',
				42
			);

		expect((legacy.prepare('SELECT COUNT(*) as c FROM repos').get() as { c: number }).c).toBe(1);
		legacy.close();

		const first = migrateDatabase({ path: dbPath });
		expect(first.before).toBe(13);
		expect(first.applied).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]);
		expect(first.after).toBe(CURRENT_SCHEMA_VERSION);
		expect(first.status.interestingScoreExists).toBe(true);
		expect(first.status.repositoryCount).toBe(1);

		const db = getDb();
		expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
		expect(hasRepoColumn(db, 'interesting_score')).toBe(true);

		const preserved = db
			.prepare(`SELECT full_name, description, stars, language FROM repos WHERE full_name = ?`)
			.get('acme/legacy-widget') as {
			full_name: string;
			description: string;
			stars: number;
			language: string;
		};
		expect(preserved.full_name).toBe('acme/legacy-widget');
		expect(preserved.description).toBe('A preserved legacy repository');
		expect(preserved.stars).toBe(42);
		expect(preserved.language).toBe('TypeScript');

		ensureClusterRegistry();
		expect(() => getActiveQualityClusters({ limit: 5, minScore: 0 })).not.toThrow();
		expect(() => getDiscoveryLanding({ limit: 6, minScore: 0 })).not.toThrow();

		const landing = getDiscoveryLanding({ limit: 6, minScore: 0 });
		expect(Array.isArray(landing.projectsToWatch)).toBe(true);
		expect(Array.isArray(landing.unusualFinds)).toBe(true);
		expect(Array.isArray(landing.emergingTopics)).toBe(true);

		const second = migrateDatabase({ path: dbPath });
		expect(second.before).toBe(CURRENT_SCHEMA_VERSION);
		expect(second.applied).toEqual([]);
		expect(second.after).toBe(CURRENT_SCHEMA_VERSION);
		expect(second.status.repositoryCount).toBe(1);
		expect(second.status.interestingScoreExists).toBe(true);
	});

	it('repairs interesting_score when schema_version is ahead of DDL', () => {
		previousPath = process.env.DATABASE_PATH;
		tmpDir = mkdtempSync(join(tmpdir(), 'githubarchive-drift-'));
		const dbPath = join(tmpDir, 'drift.db');
		process.env.DATABASE_PATH = dbPath;

		const drifted = new Database(dbPath);
		drifted.pragma('journal_mode = WAL');
		runMigrationsThrough(drifted, 13);
		drifted
			.prepare(
				`INSERT INTO repos (
					owner, name, full_name, github_url, event_id, created_at, first_seen_at
				) VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				'drift',
				'repo',
				'drift/repo',
				'https://github.com/drift/repo',
				'evt-drift',
				'2026-06-02T00:00:00.000Z',
				'2026-06-02T00:00:00.000Z'
			);
		for (let version = 14; version <= CURRENT_SCHEMA_VERSION; version++) {
			drifted
				.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
				.run(version, new Date().toISOString());
		}
		expect(getSchemaVersion(drifted)).toBe(CURRENT_SCHEMA_VERSION);
		expect(hasRepoColumn(drifted, 'interesting_score')).toBe(false);
		drifted.close();

		const result = migrateDatabase({ path: dbPath });
		expect(result.applied).toEqual([]);
		expect(result.repairs.length).toBeGreaterThan(0);
		expect(result.status.interestingScoreExists).toBe(true);
		expect(result.status.currentSchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(result.status.repositoryCount).toBe(1);
	});
});
