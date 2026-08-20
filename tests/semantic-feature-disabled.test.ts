import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb, createTestRepo } from './helpers/db';
import { listRepos, listReposSearchAware } from '$lib/server/repos';
import { saveEnrichment } from '$lib/server/db/repos';
import { isSemanticSearchEnabled } from '$lib/server/semantic/config';
import { searchReposSemanticAware } from '$lib/server/semantic/search';

describe('semantic feature disabled', () => {
	const previous = process.env.SEMANTIC_SEARCH_ENABLED;

	beforeEach(() => {
		process.env.SEMANTIC_SEARCH_ENABLED = '0';
		setupTestDb();
	});

	afterEach(() => {
		teardownTestDb();
		if (previous === undefined) delete process.env.SEMANTIC_SEARCH_ENABLED;
		else process.env.SEMANTIC_SEARCH_ENABLED = previous;
	});

	it('keeps ordinary search working', async () => {
		expect(isSemanticSearchEnabled()).toBe(false);
		const repo = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		saveEnrichment(repo.id, {
			default_branch: 'main',
			description: 'network scanner utility',
			language: 'Go',
			stars: 12,
			forks: 0,
			watchers: 12,
			license: 'MIT',
			topics: ['network', 'scanner'],
			pushed_at: '2026-08-01T00:00:00.000Z',
			updated_at: '2026-08-01T00:00:00.000Z'
		});

		const listed = listRepos({ q: 'network', page: 1, perPage: 10 });
		expect(listed.repos.length).toBeGreaterThanOrEqual(1);

		const aware = await listReposSearchAware({
			q: 'network',
			searchMode: 'hybrid',
			page: 1,
			perPage: 10
		});
		expect(aware.repos.length).toBeGreaterThanOrEqual(1);
		expect(aware.semantic_available).toBe(false);

		const semantic = await searchReposSemanticAware({
			q: 'network',
			searchMode: 'semantic',
			page: 1,
			perPage: 10
		});
		expect(semantic.semanticAvailable).toBe(false);
		expect(semantic.repos.length).toBeGreaterThanOrEqual(1);
	});
});
