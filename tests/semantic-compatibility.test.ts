import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, teardownTestDb, createTestRepo } from './helpers/db';
import { saveEnrichment } from '$lib/server/db/repos';
import { runSemanticIndexCycle } from '$lib/server/workers/semantic-index';
import {
	getSemanticIndexState,
	markSemanticIndexed,
	upsertSemanticPending
} from '$lib/server/semantic/index-state';
import { repositoryVectorId } from '$lib/server/semantic/ids';
import { searchReposSemanticAware } from '$lib/server/semantic/search';
import {
	checkWorkerCompatibility,
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

describe('worker compatibility centralization', () => {
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

	function seedIndexedRepo() {
		const repo = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		saveEnrichment(repo.id, {
			default_branch: 'main',
			description: 'compat probe',
			language: 'Python',
			stars: 1,
			forks: 0,
			watchers: 1,
			license: 'MIT',
			topics: ['x'],
			pushed_at: '2026-08-01T00:00:00.000Z',
			updated_at: '2026-08-01T00:00:00.000Z'
		});
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
		return repo;
	}

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
			} else {
				expect(compatibilityRequiresStaleMark(result)).toBe(true);
			}
		});

		it(`skips indexing on ${c.name}`, async () => {
			const repo = seedIndexedRepo();
			vi.spyOn(client, 'semanticWorkerHealth').mockResolvedValue(
				baseHealth(c.overrides)
			);
			const indexSpy = vi.spyOn(client, 'semanticWorkerIndexBatch');

			const result = await runSemanticIndexCycle({
				batchSize: 10,
				skipReconcile: true
			});
			expect(result.skipped).toBe(true);
			expect(result.reason).toMatch(/incompatible|mismatch|unavailable/i);
			expect(indexSpy).not.toHaveBeenCalled();

			const status = getSemanticIndexState('repository', String(repo.id))?.status;
			if (c.field === 'schemaVersion') {
				// Schema mismatches require rebuild; do not thrash rows to stale.
				expect(status).toBe('indexed');
				expect(result.reason).toMatch(/rebuild/i);
			} else {
				expect(status).toBe('stale');
			}
		});

		it(`falls back semantic search on ${c.name}`, async () => {
			seedIndexedRepo();
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

	it('treats HTTP-healthy but unavailable ok:false as incompatible without stale mark fields', () => {
		const result = checkWorkerCompatibility(
			{ ...baseHealth(), ok: false },
			getSemanticConfig()
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.mismatchedFields).toEqual(['ok']);
	});
});
