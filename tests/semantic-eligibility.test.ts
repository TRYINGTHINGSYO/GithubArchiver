import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, teardownTestDb, createTestRepo } from './helpers/db';
import { saveEnrichment } from '$lib/server/db/repos';
import { getDb } from '$lib/server/db/connection';
import { searchReposSemanticAware } from '$lib/server/semantic/search';
import * as client from '$lib/server/semantic/client';
import { upsertSemanticPending, markSemanticIndexed } from '$lib/server/semantic/index-state';
import { repositoryVectorId } from '$lib/server/semantic/ids';

function enrich(id: number, description: string) {
	saveEnrichment(id, {
		default_branch: 'main',
		description,
		language: 'Python',
		stars: 20,
		forks: 0,
		watchers: 20,
		license: 'MIT',
		topics: ['tools'],
		pushed_at: '2026-08-01T00:00:00.000Z',
		updated_at: '2026-08-01T00:00:00.000Z'
	});
}

function markIndexed(id: number) {
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

function mockHealthyWorker(indexedCount: number) {
	vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue({
		ok: true,
		modelId: 'hashing-v1',
		dimensions: 384,
		vectorBits: 2,
		indexedCount,
		indexPath: './data/semantic/index.tvim',
		schemaVersion: 1,
		semanticDocumentVersion: 1
	});
}

describe('semantic search baseline eligibility', () => {
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

	it('never returns a deleted repo from semantic hits without explicit hard filters', async () => {
		const alive = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		enrich(alive.id, 'alive network monitoring tool');
		markIndexed(alive.id);

		const deleted = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		enrich(deleted.id, 'deleted network monitoring tool');
		markIndexed(deleted.id);
		getDb()
			.prepare(`UPDATE repos SET deleted_at = ? WHERE id = ?`)
			.run('2026-08-20T00:00:00.000Z', deleted.id);

		mockHealthyWorker(2);
		// Vector still present in TurboVec (deletion worker has not caught up).
		vi.spyOn(client, 'semanticWorkerSearch').mockResolvedValue([
			{ vectorId: deleted.id, score: 0.99 },
			{ vectorId: alive.id, score: 0.8 }
		]);

		const result = await searchReposSemanticAware({
			q: 'network monitoring',
			searchMode: 'semantic',
			page: 1,
			perPage: 10
		});

		expect(result.semanticAvailable).toBe(true);
		expect(result.repos.some((r) => r.id === deleted.id)).toBe(false);
		expect(result.repos.some((r) => r.id === alive.id)).toBe(true);
	});

	it('never returns a pending-deletion repo from semantic hits without explicit hard filters', async () => {
		const alive = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		enrich(alive.id, 'alive voice assistant');
		markIndexed(alive.id);

		const pending = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		enrich(pending.id, 'pending voice assistant');
		markIndexed(pending.id);
		getDb()
			.prepare(`UPDATE repos SET pending_deletion_at = ? WHERE id = ?`)
			.run('2026-08-20T00:00:00.000Z', pending.id);

		mockHealthyWorker(2);
		vi.spyOn(client, 'semanticWorkerSearch').mockResolvedValue([
			{ vectorId: pending.id, score: 0.99 },
			{ vectorId: alive.id, score: 0.7 }
		]);

		const result = await searchReposSemanticAware({
			q: 'voice assistant',
			searchMode: 'semantic',
			page: 1,
			perPage: 10
		});

		expect(result.semanticAvailable).toBe(true);
		expect(result.repos.some((r) => r.id === pending.id)).toBe(false);
		expect(result.repos.some((r) => r.id === alive.id)).toBe(true);
	});
});
