import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, getDb } from '$lib/server/db/connection';
import { insertRepo } from '$lib/server/db/repos';
import type { EnrichmentData, RepoRow } from '$lib/server/db/types';

let tmpDir: string | null = null;
let repoCounter = 0;

export function setupTestDb(): void {
	closeDb();
	repoCounter = 0;
	tmpDir = mkdtempSync(join(tmpdir(), 'githubarchive-test-'));
	process.env.DATABASE_PATH = join(tmpDir, 'test.db');
	getDb();
}

export function teardownTestDb(): void {
	closeDb();
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = null;
	}
}

export function historyCounts(repoId: number) {
	const db = getDb();
	const scalar = (sql: string) =>
		(db.prepare(sql).get(repoId) as { c: number }).c;

	return {
		commits: scalar('SELECT COUNT(*) as c FROM repo_commit_snapshots WHERE repo_id = ?'),
		licenses: scalar('SELECT COUNT(*) as c FROM repo_license_history WHERE repo_id = ?'),
		topics: scalar('SELECT COUNT(*) as c FROM repo_topics_history WHERE repo_id = ?'),
		events: scalar('SELECT COUNT(*) as c FROM repository_events WHERE repo_id = ?')
	};
}

export function eventCountsByType(repoId: number): Record<string, number> {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT event_type, COUNT(*) as c FROM repository_events
			 WHERE repo_id = ? GROUP BY event_type`
		)
		.all(repoId) as { event_type: string; c: number }[];
	const out: Record<string, number> = {};
	for (const row of rows) out[row.event_type] = row.c;
	return out;
}

export function createTestRepo(opts: {
	license?: string | null;
	topics?: string[];
	enriched_at?: string | null;
} = {}): RepoRow {
	const n = ++repoCounter;
	const now = '2026-07-01T12:00:00.000Z';
	const owner = `acme-${n}`;
	const name = `widget-${n}`;
	const result = insertRepo({
		owner,
		name,
		full_name: `${owner}/${name}`,
		github_url: `https://github.com/${owner}/${name}`,
		event_id: 'evt-1',
		created_at: now,
		first_seen_at: now,
		discovery_source: 'github_search'
	});
	if (!result.id) throw new Error('failed to insert test repo');

	const db = getDb();
	db.prepare(
		`UPDATE repos SET license = ?, topics = ?, enriched_at = ?, default_branch = 'main'
		 WHERE id = ?`
	).run(
		opts.license ?? 'MIT',
		opts.topics ? JSON.stringify(opts.topics) : null,
		opts.enriched_at === undefined ? now : opts.enriched_at,
		result.id
	);

	const row = db.prepare('SELECT * FROM repos WHERE id = ?').get(result.id) as RepoRow;
	return row;
}

export function testEnrichment(overrides: Partial<EnrichmentData> = {}): EnrichmentData {
	return {
		default_branch: 'main',
		description: 'A widget',
		language: 'TypeScript',
		stars: 10,
		forks: 2,
		watchers: 10,
		open_issues: 0,
		size: 100,
		homepage: null,
		visibility: 'public',
		owner_avatar_url: null,
		owner_type: 'User',
		license: 'MIT',
		topics: ['typescript'],
		pushed_at: '2026-07-01T11:00:00.000Z',
		updated_at: '2026-07-01T12:00:00.000Z',
		...overrides
	};
}

export const MOCK_COMMIT = {
	sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
	tree_sha: 'tree111111111111111111111111111111111111',
	parent_sha: 'parent111111111111111111111111111111111',
	committed_at: '2026-07-01T11:30:00.000Z',
	author_name: 'Ada',
	author_email: 'ada@example.com'
};
