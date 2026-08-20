import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, teardownTestDb, createTestRepo } from './helpers/db';
import { saveEnrichment } from '$lib/server/db/repos';
import { getDb } from '$lib/server/db/connection';
import { searchReposSemanticAware } from '$lib/server/semantic/search';
import * as client from '$lib/server/semantic/client';
import { upsertSemanticPending, markSemanticIndexed } from '$lib/server/semantic/index-state';
import { repositoryVectorId } from '$lib/server/semantic/ids';

describe('semantic search integration', () => {
	const prevEnabled = process.env.SEMANTIC_SEARCH_ENABLED;

	beforeEach(() => {
		process.env.SEMANTIC_SEARCH_ENABLED = '1';
		setupTestDb();
	});

	afterEach(() => {
		teardownTestDb();
		vi.restoreAllMocks();
		if (prevEnabled === undefined) delete process.env.SEMANTIC_SEARCH_ENABLED;
		else process.env.SEMANTIC_SEARCH_ENABLED = prevEnabled;
	});

	it('ranks voice-assistant repos above unrelated ones for a meaning query', async () => {
		const voice = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		saveEnrichment(voice.id, {
			default_branch: 'main',
			description: 'Local voice assistant with wake word',
			language: 'Python',
			stars: 20,
			forks: 0,
			watchers: 20,
			license: 'MIT',
			topics: ['voice-assistant', 'speech'],
			pushed_at: '2026-08-01T00:00:00.000Z',
			updated_at: '2026-08-01T00:00:00.000Z'
		});
		const noise = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		saveEnrichment(noise.id, {
			default_branch: 'main',
			description: 'Pretty photo gallery theme',
			language: 'CSS',
			stars: 5000,
			forks: 0,
			watchers: 5000,
			license: 'MIT',
			topics: ['photos'],
			pushed_at: '2026-08-01T00:00:00.000Z',
			updated_at: '2026-08-01T00:00:00.000Z'
		});

		for (const id of [voice.id, noise.id]) {
			upsertSemanticPending({
				entityType: 'repository',
				entityKey: String(id),
				vectorId: repositoryVectorId(id),
				fingerprint: 'fp'
			});
			markSemanticIndexed({
				entityType: 'repository',
				entityKey: String(id),
				fingerprint: 'fp',
				embeddingModel: 'hashing-v1',
				documentVersion: 1,
				dimensions: 384,
				vectorBits: 2
			});
		}

		vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue({
			ok: true,
			modelId: 'hashing-v1',
			dimensions: 384,
			vectorBits: 2,
			indexedCount: 2,
			indexPath: './data/semantic/index.tvim',
			schemaVersion: 1,
			semanticDocumentVersion: 1
		});
		vi.spyOn(client, 'semanticWorkerSearch').mockResolvedValue([
			{ vectorId: voice.id, score: 0.95 },
			{ vectorId: noise.id, score: 0.05 }
		]);

		const result = await searchReposSemanticAware({
			q: 'local voice assistant',
			searchMode: 'semantic',
			page: 1,
			perPage: 10
		});
		expect(result.semanticAvailable).toBe(true);
		expect(result.repos[0]?.id).toBe(voice.id);
	});

	it('never returns language-filtered-out repos from semantic hits', async () => {
		const rust = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		saveEnrichment(rust.id, {
			default_branch: 'main',
			description: 'network monitoring in rust',
			language: 'Rust',
			stars: 100,
			forks: 0,
			watchers: 100,
			license: 'MIT',
			topics: ['monitoring'],
			pushed_at: '2026-08-01T00:00:00.000Z',
			updated_at: '2026-08-01T00:00:00.000Z'
		});
		const python = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		saveEnrichment(python.id, {
			default_branch: 'main',
			description: 'network monitoring in python',
			language: 'Python',
			stars: 100,
			forks: 0,
			watchers: 100,
			license: 'MIT',
			topics: ['monitoring'],
			pushed_at: '2026-08-01T00:00:00.000Z',
			updated_at: '2026-08-01T00:00:00.000Z'
		});

		vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue({
			ok: true,
			modelId: 'hashing-v1',
			dimensions: 384,
			vectorBits: 2,
			indexedCount: 2,
			indexPath: './data/semantic/index.tvim',
			schemaVersion: 1,
			semanticDocumentVersion: 1
		});
		const searchSpy = vi.spyOn(client, 'semanticWorkerSearch').mockImplementation(async (opts) => {
			expect(opts.allowlist).toEqual([rust.id]);
			return [{ vectorId: rust.id, score: 0.9 }];
		});

		const result = await searchReposSemanticAware({
			q: 'network monitoring',
			language: 'Rust',
			searchMode: 'hybrid',
			page: 1,
			perPage: 10
		});
		expect(searchSpy).toHaveBeenCalled();
		expect(result.repos.every((r) => r.language === 'Rust')).toBe(true);
		expect(result.repos.some((r) => r.id === python.id)).toBe(false);
	});

	it('survives worker failure by falling back to FTS', async () => {
		const repo = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		saveEnrichment(repo.id, {
			default_branch: 'main',
			description: 'download manager',
			language: 'JavaScript',
			stars: 10,
			forks: 0,
			watchers: 10,
			license: 'MIT',
			topics: ['downloads'],
			pushed_at: '2026-08-01T00:00:00.000Z',
			updated_at: '2026-08-01T00:00:00.000Z'
		});
		vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue(null);
		const result = await searchReposSemanticAware({
			q: 'download',
			searchMode: 'hybrid',
			page: 1,
			perPage: 10
		});
		expect(result.semanticAvailable).toBe(false);
		expect(result.repos.length).toBeGreaterThanOrEqual(1);
		void getDb();
	});
});
