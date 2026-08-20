import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, teardownTestDb, createTestRepo } from './helpers/db';
import { saveEnrichment } from '$lib/server/db/repos';
import { getDb } from '$lib/server/db/connection.js';
import {
	enqueueMissingRepositories,
	listReposNeedingSemanticIndex,
	removeDeletedFromIndex,
	runSemanticIndexCycle
} from '$lib/server/workers/semantic-index';
import {
	getSemanticIndexState,
	markSemanticIndexed,
	upsertSemanticPending
} from '$lib/server/semantic/index-state';
import { repositoryVectorId } from '$lib/server/semantic/ids';
import * as client from '$lib/server/semantic/client';
import { filterRepoIdsByQuery, searchReposSemanticAware } from '$lib/server/semantic/search';

describe('semantic index durability and backfill', () => {
	const prev = process.env.SEMANTIC_SEARCH_ENABLED;

	beforeEach(() => {
		process.env.SEMANTIC_SEARCH_ENABLED = '1';
		setupTestDb();
	});

	afterEach(() => {
		teardownTestDb();
		vi.restoreAllMocks();
		if (prev === undefined) delete process.env.SEMANTIC_SEARCH_ENABLED;
		else process.env.SEMANTIC_SEARCH_ENABLED = prev;
	});

	function enrich(id: number, description: string, language = 'Python') {
		saveEnrichment(id, {
			default_branch: 'main',
			description,
			language,
			stars: 5,
			forks: 0,
			watchers: 5,
			license: 'MIT',
			topics: ['tools'],
			pushed_at: '2026-08-01T00:00:00.000Z',
			updated_at: '2026-08-01T00:00:00.000Z'
		});
	}

	it('does not starve older missing repos when newest are already indexed', () => {
		const newest: number[] = [];
		for (let i = 0; i < 5; i++) {
			const repo = createTestRepo({ enriched_at: `2026-08-0${i + 1}T00:00:00.000Z` });
			enrich(repo.id, `newest repo ${i}`);
			newest.push(repo.id);
			upsertSemanticPending({
				entityType: 'repository',
				entityKey: String(repo.id),
				vectorId: repositoryVectorId(repo.id),
				fingerprint: `fp-new-${i}`
			});
			markSemanticIndexed({
				entityType: 'repository',
				entityKey: String(repo.id),
				fingerprint: `fp-new-${i}`,
				embeddingModel: 'hashing-v1',
				documentVersion: 1,
				dimensions: 384,
				vectorBits: 2
			});
		}

		const older: number[] = [];
		for (let i = 0; i < 8; i++) {
			const repo = createTestRepo({ enriched_at: '2026-07-01T00:00:00.000Z' });
			enrich(repo.id, `older archive repo ${i}`);
			older.push(repo.id);
		}

		// enqueueLimit smaller than newest+older, focused on missing/stale only.
		const needing = listReposNeedingSemanticIndex(5);
		expect(needing.every((r) => older.includes(r.id))).toBe(true);
		expect(needing.some((r) => newest.includes(r.id))).toBe(false);

		const queued = enqueueMissingRepositories(5);
		expect(queued).toBeGreaterThan(0);
		for (const id of needing.map((r) => r.id)) {
			expect(getSemanticIndexState('repository', String(id))?.status).toBe('pending');
		}
	});

	it('syncs TurboVec before marking rows indexed', async () => {
		const repo = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		enrich(repo.id, 'voice assistant');
		enqueueMissingRepositories(10);

		const order: string[] = [];
		vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue({
			ok: true,
			modelId: 'hashing-v1',
			dimensions: 384,
			vectorBits: 2,
			indexedCount: 0,
			indexPath: './data/semantic/index.tvim',
			schemaVersion: 1,
			semanticDocumentVersion: 1
		});
		vi.spyOn(client, 'semanticWorkerContains').mockResolvedValue({
			present: [],
			missing: []
		});
		vi.spyOn(client, 'semanticWorkerIndexBatch').mockImplementation(async () => {
			order.push('upsert');
			return { indexed: 1, failed: [] };
		});
		vi.spyOn(client, 'semanticWorkerSync').mockImplementation(async () => {
			order.push('sync');
			return { ok: true, lastSyncAt: '2026-08-20T00:00:00Z' };
		});
		vi.spyOn(client, 'semanticWorkerRemove').mockResolvedValue({ removed: 0 });

		const result = await runSemanticIndexCycle({
			batchSize: 10,
			enqueueLimit: 10,
			skipReconcile: true
		});
		expect(result.indexed).toBe(1);
		expect(order).toEqual(['upsert', 'sync']);
		expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe('indexed');
	});

	it('leaves rows retryable when sync fails after upsert', async () => {
		const repo = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		enrich(repo.id, 'network scanner');
		enqueueMissingRepositories(10);

		vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue({
			ok: true,
			modelId: 'hashing-v1',
			dimensions: 384,
			vectorBits: 2,
			indexedCount: 0,
			indexPath: './data/semantic/index.tvim',
			schemaVersion: 1,
			semanticDocumentVersion: 1
		});
		vi.spyOn(client, 'semanticWorkerContains').mockResolvedValue({
			present: [],
			missing: []
		});
		vi.spyOn(client, 'semanticWorkerIndexBatch').mockResolvedValue({
			indexed: 1,
			failed: []
		});
		vi.spyOn(client, 'semanticWorkerSync').mockRejectedValue(new Error('disk full'));
		vi.spyOn(client, 'semanticWorkerRemove').mockResolvedValue({ removed: 0 });

		const result = await runSemanticIndexCycle({
			batchSize: 10,
			skipReconcile: true
		});
		expect(result.indexed).toBe(0);
		expect(result.failed).toBe(1);
		const state = getSemanticIndexState('repository', String(repo.id));
		expect(state?.status).toBe('failed');
		expect(state?.last_error).toMatch(/sync failed before commit/);
	});

	it('durably syncs removals-only cycles before marking removed', async () => {
		const repo = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		enrich(repo.id, 'to delete');
		upsertSemanticPending({
			entityType: 'repository',
			entityKey: String(repo.id),
			vectorId: repositoryVectorId(repo.id),
			fingerprint: 'fp'
		});
		markSemanticIndexed({
			entityType: 'repository',
			entityKey: String(repo.id),
			fingerprint: 'fp',
			embeddingModel: 'hashing-v1',
			documentVersion: 1,
			dimensions: 384,
			vectorBits: 2
		});
		getDb()
			.prepare(`UPDATE repos SET deleted_at = ? WHERE id = ?`)
			.run('2026-08-20T00:00:00.000Z', repo.id);

		const order: string[] = [];
		vi.spyOn(client, 'semanticWorkerRemove').mockImplementation(async () => {
			order.push('remove');
			return { removed: 1 };
		});
		vi.spyOn(client, 'semanticWorkerSync').mockImplementation(async () => {
			order.push('sync');
			return { ok: true, lastSyncAt: '2026-08-20T00:00:00Z' };
		});

		const result = await removeDeletedFromIndex();
		expect(result.removed).toBe(1);
		expect(result.synced).toBe(true);
		expect(order).toEqual(['remove', 'sync']);
		expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe('removed');
	});
});

describe('large hard-filter fallback', () => {
	const prev = process.env.SEMANTIC_SEARCH_ENABLED;
	const prevMax = process.env.SEMANTIC_ALLOWLIST_SOFT_MAX;

	beforeEach(() => {
		process.env.SEMANTIC_SEARCH_ENABLED = '1';
		process.env.SEMANTIC_ALLOWLIST_SOFT_MAX = '3';
		setupTestDb();
	});

	afterEach(() => {
		teardownTestDb();
		vi.restoreAllMocks();
		if (prev === undefined) delete process.env.SEMANTIC_SEARCH_ENABLED;
		else process.env.SEMANTIC_SEARCH_ENABLED = prev;
		if (prevMax === undefined) delete process.env.SEMANTIC_ALLOWLIST_SOFT_MAX;
		else process.env.SEMANTIC_ALLOWLIST_SOFT_MAX = prevMax;
	});

	it('keeps a high-id semantic hit that passes SQL filters outside the first-N id slice', async () => {
		const ids: number[] = [];
		for (let i = 0; i < 6; i++) {
			const repo = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
			saveEnrichment(repo.id, {
				default_branch: 'main',
				description: i === 5 ? 'best voice assistant' : `python util ${i}`,
				language: 'Python',
				stars: 10,
				forks: 0,
				watchers: 10,
				license: 'MIT',
				topics: ['python'],
				pushed_at: '2026-08-01T00:00:00.000Z',
				updated_at: '2026-08-01T00:00:00.000Z'
			});
			ids.push(repo.id);
		}
		const bestId = ids[ids.length - 1]!;
		expect(bestId).toBeGreaterThan(ids[0]!);

		// Prove the helper filters candidates by full SQL, not first-N membership.
		const filtered = filterRepoIdsByQuery([bestId, ids[0]!], {
			language: 'Python'
		});
		expect(filtered).toContain(bestId);

		vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue({
			ok: true,
			modelId: 'hashing-v1',
			dimensions: 384,
			vectorBits: 2,
			indexedCount: 6,
			indexPath: './data/semantic/index.tvim',
			schemaVersion: 1,
			semanticDocumentVersion: 1
		});
		vi.spyOn(client, 'semanticWorkerSearch').mockImplementation(async (opts) => {
			// Soft-max exceeded ⇒ no allowlist; worker returns global candidates including bestId.
			expect(opts.allowlist).toBeUndefined();
			return [
				{ vectorId: bestId, score: 0.99 },
				{ vectorId: ids[0]!, score: 0.2 }
			];
		});

		const result = await searchReposSemanticAware({
			q: 'voice assistant',
			language: 'Python',
			searchMode: 'semantic',
			page: 1,
			perPage: 10
		});
		expect(result.repos.some((r) => r.id === bestId)).toBe(true);
		expect(result.repos[0]?.id).toBe(bestId);
		expect(result.pagination).toBe('candidate-window');
	});
});
