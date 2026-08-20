import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, teardownTestDb, createTestRepo } from './helpers/db';
import { saveEnrichment } from '$lib/server/db/repos';
import { getDb } from '$lib/server/db/connection';
import { runSemanticIndexCycle } from '$lib/server/workers/semantic-index';
import {
	getSemanticIndexState,
	markSemanticIndexed,
	markSemanticStaleForModelOrVersion,
	upsertSemanticPending
} from '$lib/server/semantic/index-state';
import { repositoryVectorId } from '$lib/server/semantic/ids';
import { searchReposSemanticAware } from '$lib/server/semantic/search';
import {
	checkWorkerCompatibility,
	compatibilityRequiresRebuild,
	compatibilityRequiresStaleMark
} from '$lib/server/semantic/compatibility';
import { getSemanticConfig } from '$lib/server/semantic/config';
import type { SemanticWorkerHealth } from '$lib/server/semantic/client';
import * as client from '$lib/server/semantic/client';

function baseHealth(
	overrides: Partial<SemanticWorkerHealth> = {}
): SemanticWorkerHealth {
	return {
		ok: true,
		modelId: 'hashing-v1',
		dimensions: 384,
		vectorBits: 2,
		indexedCount: 1,
		indexPath: './data/semantic/index.tvim',
		schemaVersion: 1,
		semanticDocumentVersion: 1,
		...overrides
	};
}

function enrich(id: number, description = 'compat probe') {
	saveEnrichment(id, {
		default_branch: 'main',
		description,
		language: 'Python',
		stars: 1,
		forks: 0,
		watchers: 1,
		license: 'MIT',
		topics: ['x'],
		pushed_at: '2026-08-01T00:00:00.000Z',
		updated_at: '2026-08-01T00:00:00.000Z'
	});
}

function seedIndexedRepo(meta: {
	embeddingModel: string;
	documentVersion: number;
	dimensions: number;
	vectorBits: number;
	fingerprint?: string;
}) {
	const repo = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
	enrich(repo.id);
	upsertSemanticPending({
		entityType: 'repository',
		entityKey: String(repo.id),
		vectorId: repositoryVectorId(repo.id),
		fingerprint: meta.fingerprint ?? 'fp'
	});
	markSemanticIndexed({
		entityType: 'repository',
		entityKey: String(repo.id),
		fingerprint: meta.fingerprint ?? 'fp',
		embeddingModel: meta.embeddingModel,
		documentVersion: meta.documentVersion,
		dimensions: meta.dimensions,
		vectorBits: meta.vectorBits
	});
	return repo;
}

function countByStatus(status: string): number {
	const row = getDb()
		.prepare(`SELECT COUNT(*) AS c FROM semantic_index_state WHERE status = ?`)
		.get(status) as { c: number };
	return row.c;
}

describe('worker compatibility centralization', () => {
	const prev = process.env.SEMANTIC_SEARCH_ENABLED;
	const prevModel = process.env.SEMANTIC_EMBEDDING_MODEL;
	const prevProvider = process.env.SEMANTIC_EMBEDDING_PROVIDER;

	beforeEach(() => {
		process.env.SEMANTIC_SEARCH_ENABLED = '1';
		process.env.SEMANTIC_EMBEDDING_PROVIDER = 'hashing';
		process.env.SEMANTIC_EMBEDDING_MODEL = 'hashing-v1';
		setupTestDb();
	});

	afterEach(() => {
		teardownTestDb();
		vi.restoreAllMocks();
		if (prev === undefined) delete process.env.SEMANTIC_SEARCH_ENABLED;
		else process.env.SEMANTIC_SEARCH_ENABLED = prev;
		if (prevModel === undefined) delete process.env.SEMANTIC_EMBEDDING_MODEL;
		else process.env.SEMANTIC_EMBEDDING_MODEL = prevModel;
		if (prevProvider === undefined) delete process.env.SEMANTIC_EMBEDDING_PROVIDER;
		else process.env.SEMANTIC_EMBEDDING_PROVIDER = prevProvider;
	});

	const cases: Array<{
		name: string;
		overrides: Partial<SemanticWorkerHealth>;
		field: string;
	}> = [
		{ name: 'model mismatch', overrides: { modelId: 'other-model' }, field: 'modelId' },
		{
			name: 'dimensions mismatch',
			overrides: { dimensions: 768 },
			field: 'dimensions'
		},
		{
			name: 'bit-width mismatch',
			overrides: { vectorBits: 4 },
			field: 'vectorBits'
		},
		{
			name: 'semantic document version mismatch',
			overrides: { semanticDocumentVersion: 99 },
			field: 'semanticDocumentVersion'
		},
		{
			name: 'index schema version mismatch',
			overrides: { schemaVersion: 99 },
			field: 'schemaVersion'
		}
	];

	for (const c of cases) {
		it(`detects ${c.name} via checkWorkerCompatibility`, () => {
			const config = getSemanticConfig();
			const result = checkWorkerCompatibility(baseHealth(c.overrides), config);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.mismatchedFields).toContain(c.field);
			expect(result.reason).toMatch(/worker incompatible|unavailable/);
			if (c.field === 'schemaVersion') {
				expect(compatibilityRequiresStaleMark(result)).toBe(false);
				expect(compatibilityRequiresRebuild(result)).toBe(true);
			} else {
				expect(compatibilityRequiresStaleMark(result)).toBe(true);
			}
		});

		it(`skips indexing on ${c.name} without global corpus wipe`, async () => {
			const repo = seedIndexedRepo({
				embeddingModel: 'hashing-v1',
				documentVersion: 1,
				dimensions: 384,
				vectorBits: 2
			});
			vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue(
				baseHealth(c.overrides)
			);
			const indexSpy = vi.spyOn(client, 'semanticWorkerIndexBatch');

			const result = await runSemanticIndexCycle({
				batchSize: 10,
				skipReconcile: true
			});
			expect(result.skipped).toBe(true);
			expect(result.reason).toMatch(/incompatible|mismatch|unavailable|rebuild/i);
			expect(indexSpy).not.toHaveBeenCalled();

			// Healthy rows matching app config stay indexed — worker misconfig
			// must not force a full re-embed.
			expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe(
				'indexed'
			);
			if (c.field === 'schemaVersion') {
				expect(result.reason).toMatch(/rebuild/i);
			}
		});

		it(`falls back semantic search on ${c.name}`, async () => {
			seedIndexedRepo({
				embeddingModel: 'hashing-v1',
				documentVersion: 1,
				dimensions: 384,
				vectorBits: 2
			});
			vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue(
				baseHealth(c.overrides)
			);
			const searchSpy = vi.spyOn(client, 'semanticWorkerSearch');

			const result = await searchReposSemanticAware({
				q: 'compat probe',
				searchMode: 'hybrid',
				page: 1,
				perPage: 10
			});
			expect(result.semanticAvailable).toBe(false);
			expect(searchSpy).not.toHaveBeenCalled();
		});
	}

	it('A: worker wrong model + healthy DB rows → zero rows stale', async () => {
		// App wants MiniLM; DB already matches; worker accidentally hashing-v1.
		process.env.SEMANTIC_EMBEDDING_PROVIDER = 'sentence-transformers';
		process.env.SEMANTIC_EMBEDDING_MODEL =
			'sentence-transformers/all-MiniLM-L6-v2';
		const config = getSemanticConfig();
		expect(config.embeddingModel).toBe(
			'sentence-transformers/all-MiniLM-L6-v2'
		);

		const healthy = seedIndexedRepo({
			embeddingModel: config.embeddingModel,
			documentVersion: config.documentVersion,
			dimensions: config.dimensions,
			vectorBits: config.vectorBits
		});

		vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue(
			baseHealth({
				modelId: 'hashing-v1',
				dimensions: config.dimensions,
				vectorBits: config.vectorBits,
				semanticDocumentVersion: config.documentVersion,
				schemaVersion: config.indexSchemaVersion
			})
		);
		vi.spyOn(client, 'semanticWorkerIndexBatch');

		const result = await runSemanticIndexCycle({
			batchSize: 10,
			skipReconcile: true
		});
		expect(result.skipped).toBe(true);
		expect(result.reason).toMatch(/modelId/);
		expect(getSemanticIndexState('repository', String(healthy.id))?.status).toBe(
			'indexed'
		);
		expect(countByStatus('stale')).toBe(0);

		const search = await searchReposSemanticAware({
			q: 'compat probe',
			searchMode: 'semantic',
			page: 1,
			perPage: 10
		});
		expect(search.semanticAvailable).toBe(false);
	});

	it('B: worker unavailable/null → zero state mutation', async () => {
		const repo = seedIndexedRepo({
			embeddingModel: 'hashing-v1',
			documentVersion: 1,
			dimensions: 384,
			vectorBits: 2
		});
		const before = getDb()
			.prepare(`SELECT status, updated_at FROM semantic_index_state`)
			.all() as Array<{ status: string; updated_at: string }>;

		vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue(null);

		const result = await runSemanticIndexCycle({
			batchSize: 10,
			skipReconcile: true
		});
		expect(result.skipped).toBe(true);
		expect(result.reason).toMatch(/unavailable/i);
		expect(countByStatus('stale')).toBe(0);
		expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe(
			'indexed'
		);

		const after = getDb()
			.prepare(`SELECT status, updated_at FROM semantic_index_state`)
			.all() as Array<{ status: string; updated_at: string }>;
		expect(after).toEqual(before);
	});

	it('C: mixed database state → only mismatched stored rows become stale', async () => {
		const config = getSemanticConfig();
		const match = seedIndexedRepo({
			embeddingModel: config.embeddingModel,
			documentVersion: config.documentVersion,
			dimensions: config.dimensions,
			vectorBits: config.vectorBits,
			fingerprint: 'fp-match'
		});
		const old = seedIndexedRepo({
			embeddingModel: 'old-model-v0',
			documentVersion: 0,
			dimensions: 128,
			vectorBits: 4,
			fingerprint: 'fp-old'
		});

		vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue(
			baseHealth({ modelId: 'totally-wrong-worker' })
		);

		const result = await runSemanticIndexCycle({
			batchSize: 10,
			skipReconcile: true
		});
		expect(result.skipped).toBe(true);
		expect(getSemanticIndexState('repository', String(match.id))?.status).toBe(
			'indexed'
		);
		expect(getSemanticIndexState('repository', String(old.id))?.status).toBe(
			'stale'
		);
		expect(countByStatus('stale')).toBe(1);
	});

	it('D: app config genuinely changed → only differing stored metadata goes stale', () => {
		const matchNew = seedIndexedRepo({
			embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
			documentVersion: 1,
			dimensions: 384,
			vectorBits: 2,
			fingerprint: 'fp-new'
		});
		const old = seedIndexedRepo({
			embeddingModel: 'hashing-v1',
			documentVersion: 1,
			dimensions: 384,
			vectorBits: 2,
			fingerprint: 'fp-old'
		});

		const changed = markSemanticStaleForModelOrVersion({
			embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
			documentVersion: 1,
			dimensions: 384,
			vectorBits: 2
		});
		expect(changed).toBe(1);
		expect(
			getSemanticIndexState('repository', String(matchNew.id))?.status
		).toBe('indexed');
		expect(getSemanticIndexState('repository', String(old.id))?.status).toBe(
			'stale'
		);
	});

	it('E: schema mismatch → zero stale rows + clear rebuild requirement', async () => {
		const repo = seedIndexedRepo({
			embeddingModel: 'hashing-v1',
			documentVersion: 1,
			dimensions: 384,
			vectorBits: 2
		});
		vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue(
			baseHealth({ schemaVersion: 99 })
		);

		const result = await runSemanticIndexCycle({
			batchSize: 10,
			skipReconcile: true
		});
		expect(result.skipped).toBe(true);
		expect(result.reason).toMatch(/schemaVersion/);
		expect(result.reason).toMatch(/rebuild/i);
		expect(compatibilityRequiresRebuild(
			checkWorkerCompatibility(baseHealth({ schemaVersion: 99 }), getSemanticConfig()) as Extract<
				ReturnType<typeof checkWorkerCompatibility>,
				{ ok: false }
			>
		)).toBe(true);
		expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe(
			'indexed'
		);
		expect(countByStatus('stale')).toBe(0);
	});

	it('treats HTTP-healthy but unavailable ok:false as incompatible without stale mark fields', () => {
		const result = checkWorkerCompatibility(
			{ ...baseHealth(), ok: false },
			getSemanticConfig()
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.mismatchedFields).toEqual(['ok']);
		expect(compatibilityRequiresStaleMark(result)).toBe(false);
	});
});
