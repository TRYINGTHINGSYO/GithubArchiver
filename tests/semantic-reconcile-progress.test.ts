import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, teardownTestDb, createTestRepo } from './helpers/db';
import { saveEnrichment } from '$lib/server/db/repos';
import {
	reconcileSemanticIndexState
} from '$lib/server/workers/semantic-index';
import {
	getSemanticIndexState,
	markSemanticIndexed,
	markSemanticRemoved,
	upsertSemanticPending
} from '$lib/server/semantic/index-state';
import { repositoryVectorId } from '$lib/server/semantic/ids';
import {
	getSemanticReconcileCursor
} from '$lib/server/semantic/reconcile-cursor';
import * as client from '$lib/server/semantic/client';

describe('semantic reconciliation keyset progress', () => {
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

	it('eventually repairs an inconsistent row beyond the first healthy batch', async () => {
		const batchLimit = 5;
		const ids: number[] = [];
		for (let i = 0; i < batchLimit + 3; i++) {
			const repo = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
			saveEnrichment(repo.id, {
				default_branch: 'main',
				description: `repo ${i}`,
				language: 'Python',
				stars: 1,
				forks: 0,
				watchers: 1,
				license: 'MIT',
				topics: ['x'],
				pushed_at: '2026-08-01T00:00:00.000Z',
				updated_at: '2026-08-01T00:00:00.000Z'
			});
			ids.push(repo.id);
			upsertSemanticPending({
				entityType: 'repository',
				entityKey: String(repo.id),
				vectorId: repositoryVectorId(repo.id),
				fingerprint: `fp-${i}`
			});
			markSemanticIndexed({
				entityType: 'repository',
				entityKey: String(repo.id),
				fingerprint: `fp-${i}`,
				embeddingModel: 'hashing-v1',
				documentVersion: 1,
				dimensions: 384,
				vectorBits: 2
			});
		}

		// Sort by vector_id (= repo id) — first `batchLimit` are healthy; one beyond is missing.
		const ordered = [...ids].sort((a, b) => a - b);
		const healthy = ordered.slice(0, batchLimit);
		const inconsistent = ordered[batchLimit]!;
		expect(inconsistent).toBeGreaterThan(healthy[healthy.length - 1]!);

		vi.spyOn(client, 'semanticWorkerContains').mockImplementation(async (vectorIds) => {
			const missing = vectorIds.filter((id) => id === inconsistent);
			const present = vectorIds.filter((id) => id !== inconsistent);
			return { present, missing };
		});
		vi.spyOn(client, 'semanticWorkerRemove').mockResolvedValue({ removed: 0 });
		vi.spyOn(client, 'semanticWorkerSync').mockResolvedValue({
			ok: true,
			lastSyncAt: '2026-08-20T00:00:00Z'
		});

		// First cycle: only the healthy prefix — must not repair yet, but must advance cursor.
		const first = await reconcileSemanticIndexState({ limit: batchLimit });
		expect(first.repaired).toBe(0);
		expect(getSemanticIndexState('repository', String(inconsistent))?.status).toBe(
			'indexed'
		);
		expect(getSemanticReconcileCursor('indexed')).toBe(healthy[healthy.length - 1]);

		// Repeated cycles must eventually reach and repair the inconsistent row.
		let repaired = false;
		for (let cycle = 0; cycle < 5; cycle++) {
			const result = await reconcileSemanticIndexState({ limit: batchLimit });
			if (result.repaired > 0) {
				repaired = true;
				break;
			}
		}
		expect(repaired).toBe(true);
		expect(getSemanticIndexState('repository', String(inconsistent))?.status).toBe(
			'stale'
		);
	});

	it('wraps the removed sweep cursor and covers later rows', async () => {
		const batchLimit = 3;
		const ids: number[] = [];
		for (let i = 0; i < batchLimit + 2; i++) {
			const repo = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
			ids.push(repo.id);
			upsertSemanticPending({
				entityType: 'repository',
				entityKey: String(repo.id),
				vectorId: repositoryVectorId(repo.id),
				fingerprint: `fp-rm-${i}`
			});
			markSemanticIndexed({
				entityType: 'repository',
				entityKey: String(repo.id),
				fingerprint: `fp-rm-${i}`,
				embeddingModel: 'hashing-v1',
				documentVersion: 1,
				dimensions: 384,
				vectorBits: 2
			});
			markSemanticRemoved('repository', String(repo.id));
		}

		const ordered = [...ids].sort((a, b) => a - b);
		const late = ordered[ordered.length - 1]!;

		vi.spyOn(client, 'semanticWorkerContains').mockImplementation(async (vectorIds) => {
			// Only the late removed row still has a live vector.
			const present = vectorIds.filter((id) => id === late);
			const missing = vectorIds.filter((id) => id !== late);
			return { present, missing };
		});
		const removeSpy = vi
			.spyOn(client, 'semanticWorkerRemove')
			.mockResolvedValue({ removed: 1 });
		vi.spyOn(client, 'semanticWorkerSync').mockResolvedValue({
			ok: true,
			lastSyncAt: '2026-08-20T00:00:00Z'
		});

		let removedLate = false;
		for (let cycle = 0; cycle < 6; cycle++) {
			const result = await reconcileSemanticIndexState({ limit: batchLimit });
			if (
				removeSpy.mock.calls.some((call) =>
					(call[0] as number[]).includes(late)
				)
			) {
				removedLate = true;
				expect(result.repaired).toBeGreaterThan(0);
				break;
			}
		}
		expect(removedLate).toBe(true);
	});
});
