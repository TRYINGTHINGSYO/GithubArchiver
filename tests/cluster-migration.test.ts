import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { ensureClusterRegistry, getClusterBySlug } from '$lib/server/db/clusters';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/db/schema';
import { setupTestDb, teardownTestDb } from './helpers/db';
import { reapplyRepoClusters } from '$lib/server/apply-repo-clusters';
import { insertRepo, saveEnrichment } from '$lib/server/db/repos';

describe('cluster migration', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('applies schema version 15 with cluster tables', () => {
		const db = getDb();
		const version = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;
		expect(version).toBe(CURRENT_SCHEMA_VERSION);
		expect(CURRENT_SCHEMA_VERSION).toBe(24);

		const repoCols = (db.prepare('PRAGMA table_info(repos)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(repoCols).toContain('cluster_version');
		expect(repoCols).toContain('clustered_at');

		const tables = (
			db
				.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)`)
				.all('repo_clusters', 'repository_cluster_memberships') as { name: string }[]
		).map((r) => r.name);
		expect(tables).toContain('repo_clusters');
		expect(tables).toContain('repository_cluster_memberships');

		ensureClusterRegistry();
		expect(getClusterBySlug('mcp-servers')).not.toBeNull();
	});

	it('persists cluster memberships for a repo', () => {
		const db = getDb();
		ensureClusterRegistry();

		const inserted = insertRepo({
			owner: 'acme',
			name: 'tools-mcp-server',
			full_name: 'acme/tools-mcp-server',
			github_url: 'https://github.com/acme/tools-mcp-server',
			event_id: 'evt-1',
			created_at: new Date().toISOString(),
			first_seen_at: new Date().toISOString()
		});
		expect(inserted.id).toBeDefined();

		saveEnrichment(inserted.id!, {
			default_branch: 'main',
			description: 'Model Context Protocol server',
			language: 'TypeScript',
			stars: 10,
			forks: 2,
			watchers: 3,
			license: 'MIT',
			topics: ['mcp', 'ai'],
			pushed_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		});

		const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(inserted.id) as {
			id: number;
			category: string | null;
		};
		db.prepare('UPDATE repos SET category = ? WHERE id = ?').run('ai-project', repo.id);

		const fullRepo = db.prepare('SELECT * FROM repos WHERE id = ?').get(repo.id);
		const slugs = reapplyRepoClusters(fullRepo as never);
		expect(slugs).toContain('mcp-servers');

		const memberships = db
			.prepare(
				`SELECT c.slug, m.confidence FROM repository_cluster_memberships m
				 JOIN repo_clusters c ON c.id = m.cluster_id
				 WHERE m.repository_id = ?`
			)
			.all(repo.id) as { slug: string; confidence: number }[];

		expect(memberships.some((row) => row.slug === 'mcp-servers')).toBe(true);
	});
});
