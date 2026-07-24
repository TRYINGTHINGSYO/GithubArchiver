import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateAndSaveArchiveStory } from '$lib/server/archive-story';
import { getStoredArchiveStory } from '$lib/server/db/archive-story';
import { ensureClusterRegistry } from '$lib/server/db/clusters';
import { getDb } from '$lib/server/db/connection';
import { insertRepo, saveEnrichment } from '$lib/server/db/repos';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/db/schema';
import { reapplyRepoClusters } from '$lib/server/apply-repo-clusters';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('archive story migration', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('applies schema version 16 with story columns', () => {
		const db = getDb();
		const version = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;
		expect(version).toBe(CURRENT_SCHEMA_VERSION);

		const repoCols = (db.prepare('PRAGMA table_info(repos)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(repoCols).toContain('story_facts_json');
		expect(repoCols).toContain('story_text');
		expect(repoCols).toContain('story_version');
		expect(repoCols).toContain('story_generated_at');
	});

	it('persists a generated story for a clustered repo', () => {
		const db = getDb();
		ensureClusterRegistry();

		const inserted = insertRepo({
			owner: 'acme',
			name: 'tools-mcp-server',
			full_name: 'acme/tools-mcp-server',
			github_url: 'https://github.com/acme/tools-mcp-server',
			event_id: 'evt-story-1',
			created_at: '2026-07-15T10:00:00.000Z',
			first_seen_at: '2026-07-15T11:00:00.000Z'
		});

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

		db.prepare(
			`UPDATE repos SET
			   category = 'ai-project',
			   interesting_score = 78,
			   signal_tier = 'high'
			 WHERE id = ?`
		).run(inserted.id);

		const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(inserted.id);
		reapplyRepoClusters(repo as never);

		const result = generateAndSaveArchiveStory(repo as never);
		expect(result.story.length).toBeGreaterThan(20);
		expect(result.facts.primaryCluster?.slug).toBe('mcp-servers');

		const stored = getStoredArchiveStory(inserted.id!);
		expect(stored?.story_text).toBe(result.story);
		expect(stored?.story_version).toBe(2);
	});
});
