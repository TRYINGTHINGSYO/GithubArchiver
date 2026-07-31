import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	resetCollectionMembershipsForTests,
	setCollectionMembership,
	subscribeCollectionMembership,
	type CollectionMembershipSnapshot
} from '$lib/collection-membership';

afterEach(() => {
	resetCollectionMembershipsForTests();
	vi.unstubAllGlobals();
});

describe('collection membership client coordinator', () => {
	it('hydrates all visible controls in one HTTP batch', async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			Response.json({
				ok: true,
				memberships: [
					{ repo_id: 11, favorites: true, watch_later: false },
					{ repo_id: 12, favorites: false, watch_later: true }
				]
			})
		);
		vi.stubGlobal('fetch', fetchMock);
		let first: CollectionMembershipSnapshot | null = null;
		let second: CollectionMembershipSnapshot | null = null;
		const unsubscribeFirst = subscribeCollectionMembership(11, (value) => (first = value));
		const unsubscribeSecond = subscribeCollectionMembership(12, (value) => (second = value));

		await vi.waitFor(() => expect(first?.hydrated && second?.hydrated).toBe(true));
		expect(fetchMock).toHaveBeenCalledOnce();
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(JSON.parse(String(init.body))).toEqual({ repo_ids: [11, 12] });
		expect(first).toMatchObject({ favorites: true, watch_later: false });
		expect(second).toMatchObject({ favorites: false, watch_later: true });
		unsubscribeFirst();
		unsubscribeSecond();
	});

	it('publishes an optimistic update before the mutation response', async () => {
		const snapshots: CollectionMembershipSnapshot[] = [];
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			Response.json({
				ok: true,
				memberships: [{ repo_id: 21, favorites: false, watch_later: false }]
			})
		);
		vi.stubGlobal('fetch', fetchMock);
		const unsubscribe = subscribeCollectionMembership(21, (value) => snapshots.push(value));
		await vi.waitFor(() => expect(snapshots.at(-1)?.hydrated).toBe(true));

		let resolveMutation!: (response: Response) => void;
		fetchMock.mockImplementationOnce(
			() => new Promise<Response>((resolve) => (resolveMutation = resolve))
		);
		const mutation = setCollectionMembership(21, 'favorites', true);
		expect(snapshots.at(-1)).toMatchObject({ favorites: true, pending: ['favorites'] });
		resolveMutation(
			Response.json({
				ok: true,
				membership: { favorites: true, watch_later: false }
			})
		);
		await mutation;
		expect(snapshots.at(-1)).toMatchObject({ favorites: true, pending: [] });
		unsubscribe();
	});
});
