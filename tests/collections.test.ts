import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	addRepositoryToCollection,
	getOrCreateSystemCollection,
	getRepositoryCollectionMemberships,
	listCollectionRepositories,
	removeRepositoryFromCollection
} from '$lib/server/db/collections';
import { getDb } from '$lib/server/db/connection';
import { setRepoFavorite } from '$lib/server/db/favorites';
import type { CollectionOwner } from '$lib/server/collection-owner';
import { createTestRepo, setupTestDb, teardownTestDb } from './helpers/db';

const owner: CollectionOwner = {
	owner_type: 'anonymous',
	owner_key: ' ANON:550E8400-E29B-41D4-A716-446655440000 '
};

describe('owner-scoped collections', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('creates one canonical system collection per owner and kind', () => {
		const first = getOrCreateSystemCollection(owner, 'favorites');
		const second = getOrCreateSystemCollection(owner, 'favorites');
		const watchLater = getOrCreateSystemCollection(owner, 'watch_later');

		expect(second.id).toBe(first.id);
		expect(watchLater.id).not.toBe(first.id);
		const rows = getDb()
			.prepare('SELECT owner_key, kind FROM collections ORDER BY kind')
			.all() as Array<{ owner_key: string; kind: string }>;
		expect(rows).toEqual([
			{ owner_key: 'anon:550e8400-e29b-41d4-a716-446655440000', kind: 'favorites' },
			{ owner_key: 'anon:550e8400-e29b-41d4-a716-446655440000', kind: 'watch_later' }
		]);
	});

	it('adds, batch-loads, lists, and removes memberships idempotently', () => {
		const firstRepo = createTestRepo({ topics: ['typescript'] });
		const secondRepo = createTestRepo({ topics: ['svelte'] });

		expect(addRepositoryToCollection(owner, 'favorites', firstRepo.id).created).toBe(true);
		expect(addRepositoryToCollection(owner, 'favorites', firstRepo.id).created).toBe(false);
		expect(addRepositoryToCollection(owner, 'watch_later', secondRepo.id).created).toBe(true);

		const memberships = getRepositoryCollectionMemberships(owner, [firstRepo.id, secondRepo.id]);
		expect(memberships.get(firstRepo.id)).toEqual({ favorites: true, watch_later: false });
		expect(memberships.get(secondRepo.id)).toEqual({ favorites: false, watch_later: true });
		expect(listCollectionRepositories(owner, 'favorites')).toMatchObject([
			{ id: firstRepo.id, topics: ['typescript'] }
		]);
		expect(
			(getDb().prepare('SELECT COUNT(*) AS c FROM collection_repositories').get() as { c: number }).c
		).toBe(2);

		expect(removeRepositoryFromCollection(owner, 'favorites', firstRepo.id).removed).toBe(true);
		expect(removeRepositoryFromCollection(owner, 'favorites', firstRepo.id).removed).toBe(false);
		expect(getRepositoryCollectionMemberships(owner, [firstRepo.id]).get(firstRepo.id)).toEqual({
			favorites: false,
			watch_later: false
		});
	});

	it('does not reuse the admin-only repo_favorites protection table', () => {
		const repo = createTestRepo();
		setRepoFavorite(repo.id, true);

		expect(getRepositoryCollectionMemberships(owner, [repo.id]).get(repo.id)).toEqual({
			favorites: false,
			watch_later: false
		});
		addRepositoryToCollection(owner, 'favorites', repo.id);
		expect(
			(getDb().prepare('SELECT COUNT(*) AS c FROM repo_favorites').get() as { c: number }).c
		).toBe(1);
		expect(
			(getDb().prepare('SELECT COUNT(*) AS c FROM collection_repositories').get() as { c: number }).c
		).toBe(1);
	});
});
