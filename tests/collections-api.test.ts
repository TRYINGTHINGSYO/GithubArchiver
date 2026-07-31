import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as batchMemberships } from '../src/routes/api/collections/memberships/+server';
import {
	DELETE as removeMembership,
	PUT as addMembership
} from '../src/routes/api/collections/[kind]/repositories/[repoId]/+server';
import type { CollectionOwner } from '$lib/server/collection-owner';
import { createTestRepo, setupTestDb, teardownTestDb } from './helpers/db';

const collectionOwner: CollectionOwner = {
	owner_type: 'anonymous',
	owner_key: 'anon:550e8400-e29b-41d4-a716-446655440000'
};

describe('collection membership API', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('keeps PUT and DELETE idempotent', async () => {
		const repo = createTestRepo();
		const event = {
			locals: { collectionOwner },
			params: { kind: 'favorites', repoId: String(repo.id) }
		} as never;

		const firstPut = await addMembership(event);
		const secondPut = await addMembership(event);
		expect(await firstPut.json()).toMatchObject({ ok: true, created: true });
		expect(await secondPut.json()).toMatchObject({ ok: true, created: false });

		const firstDelete = await removeMembership(event);
		const secondDelete = await removeMembership(event);
		expect(await firstDelete.json()).toMatchObject({ ok: true, removed: true });
		expect(await secondDelete.json()).toMatchObject({ ok: true, removed: false });
	});

	it('batch-hydrates multiple repository memberships', async () => {
		const favorite = createTestRepo();
		const unsaved = createTestRepo();
		await addMembership({
			locals: { collectionOwner },
			params: { kind: 'favorites', repoId: String(favorite.id) }
		} as never);

		const response = await batchMemberships({
			locals: { collectionOwner },
			request: new Request('http://localhost/api/collections/memberships', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ repo_ids: [favorite.id, unsaved.id] })
			})
		} as never);
		expect(await response.json()).toEqual({
			ok: true,
			memberships: [
				{ repo_id: favorite.id, favorites: true, watch_later: false },
				{ repo_id: unsaved.id, favorites: false, watch_later: false }
			]
		});
	});
});
