import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb, createTestRepo } from './helpers/db';
import { saveEnrichment } from '$lib/server/db/repos';
import { getDb } from '$lib/server/db/connection';
import {
	getSemanticIndexState,
	markSemanticFailed,
	markSemanticIndexed,
	markSemanticRemoved,
	markSemanticStaleForModelOrVersion,
	upsertSemanticPending
} from '$lib/server/semantic/index-state';
import { semanticFingerprint } from '$lib/server/semantic/fingerprint';
import { buildRepositorySemanticDocument } from '$lib/server/semantic/document';
import { repositoryVectorId } from '$lib/server/semantic/ids';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/db/schema';

describe('semantic index state', () => {
	beforeEach(() => {
		setupTestDb();
	});

	afterEach(() => {
		teardownTestDb();
	});

	it('migrates semantic_index_state', () => {
		const version = (
			getDb().prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number }
		).v;
		expect(version).toBe(CURRENT_SCHEMA_VERSION);
		const row = getDb()
			.prepare(
				`SELECT name FROM sqlite_master WHERE type='table' AND name='semantic_index_state'`
			)
			.get() as { name: string } | undefined;
		expect(row?.name).toBe('semantic_index_state');
	});

	it('tracks new, unchanged, changed, failed, and removed states', () => {
		const repo = createTestRepo({
			topics: ['voice', 'assistant'],
			enriched_at: '2026-08-01T00:00:00.000Z'
		});
		saveEnrichment(repo.id, {
			default_branch: 'main',
			description: 'Local voice assistant',
			language: 'Python',
			stars: 10,
			forks: 0,
			watchers: 10,
			license: 'MIT',
			topics: ['voice', 'assistant'],
			pushed_at: '2026-08-01T00:00:00.000Z',
			updated_at: '2026-08-01T00:00:00.000Z'
		});
		const refreshed = getDb().prepare('SELECT * FROM repos WHERE id = ?').get(repo.id) as typeof repo;
		const document = buildRepositorySemanticDocument(refreshed);
		const fingerprint = semanticFingerprint({
			entityKey: String(repo.id),
			document,
			embeddingModel: 'hashing-v1'
		});

		upsertSemanticPending({
			entityType: 'repository',
			entityKey: String(repo.id),
			vectorId: repositoryVectorId(repo.id),
			fingerprint
		});
		expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe('pending');

		markSemanticIndexed({
			entityType: 'repository',
			entityKey: String(repo.id),
			fingerprint,
			embeddingModel: 'hashing-v1',
			documentVersion: 1,
			dimensions: 384,
			vectorBits: 2
		});
		expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe('indexed');

		// unchanged fingerprint stays indexed
		upsertSemanticPending({
			entityType: 'repository',
			entityKey: String(repo.id),
			vectorId: repositoryVectorId(repo.id),
			fingerprint
		});
		expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe('indexed');

		const changed = semanticFingerprint({
			entityKey: String(repo.id),
			document: document + '\nextra',
			embeddingModel: 'hashing-v1'
		});
		upsertSemanticPending({
			entityType: 'repository',
			entityKey: String(repo.id),
			vectorId: repositoryVectorId(repo.id),
			fingerprint: changed
		});
		expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe('pending');

		markSemanticFailed('repository', String(repo.id), 'boom');
		expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe('failed');

		markSemanticStaleForModelOrVersion({
			embeddingModel: 'other-model',
			documentVersion: 1,
			dimensions: 384,
			vectorBits: 2
		});
		expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe('stale');

		markSemanticRemoved('repository', String(repo.id));
		expect(getSemanticIndexState('repository', String(repo.id))?.status).toBe('removed');
	});
});
