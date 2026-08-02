export type SystemCollectionKind = 'favorites' | 'watch_later';

export interface CollectionMembershipSnapshot {
	favorites: boolean;
	watch_later: boolean;
	hydrated: boolean;
	pending: SystemCollectionKind[];
}

type Listener = (snapshot: CollectionMembershipSnapshot) => void;

interface Entry {
	favorites: boolean;
	watch_later: boolean;
	hydrated: boolean;
	pending: Set<SystemCollectionKind>;
	listeners: Set<Listener>;
	revision: number;
	mutationRevisions: Record<SystemCollectionKind, number>;
}

const entries = new Map<number, Entry>();
const hydrationQueue = new Set<number>();
let hydrationScheduled = false;

function entryFor(repoId: number): Entry {
	let entry = entries.get(repoId);
	if (!entry) {
		entry = {
			favorites: false,
			watch_later: false,
			hydrated: false,
			pending: new Set(),
			listeners: new Set(),
			revision: 0,
			mutationRevisions: { favorites: 0, watch_later: 0 }
		};
		entries.set(repoId, entry);
	}
	return entry;
}

function snapshot(entry: Entry): CollectionMembershipSnapshot {
	return {
		favorites: entry.favorites,
		watch_later: entry.watch_later,
		hydrated: entry.hydrated,
		pending: [...entry.pending]
	};
}

function notify(entry: Entry): void {
	const next = snapshot(entry);
	for (const listener of entry.listeners) listener(next);
}

function scheduleHydration(repoId: number): void {
	hydrationQueue.add(repoId);
	if (hydrationScheduled) return;
	hydrationScheduled = true;
	queueMicrotask(() => void flushHydration());
}

async function flushHydration(): Promise<void> {
	hydrationScheduled = false;
	const repoIds = [...hydrationQueue].slice(0, 200);
	for (const repoId of repoIds) hydrationQueue.delete(repoId);
	if (hydrationQueue.size > 0) {
		hydrationScheduled = true;
		queueMicrotask(() => void flushHydration());
	}
	if (repoIds.length === 0) return;

	const revisions = new Map(repoIds.map((repoId) => [repoId, entryFor(repoId).revision]));
	try {
		const response = await fetch('/api/collections/memberships', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ repo_ids: repoIds })
		});
		const body = (await response.json()) as {
			ok?: boolean;
			memberships?: Array<{ repo_id: number; favorites: boolean; watch_later: boolean }>;
		};
		if (!response.ok || !body.ok) throw new Error('Unable to load saved repositories.');
		const byRepo = new Map((body.memberships ?? []).map((item) => [item.repo_id, item]));
		for (const repoId of repoIds) {
			const entry = entryFor(repoId);
			const membership = byRepo.get(repoId);
			// Do not let a slower hydration response overwrite an optimistic mutation.
			if (entry.revision === revisions.get(repoId)) {
				entry.favorites = Boolean(membership?.favorites);
				entry.watch_later = Boolean(membership?.watch_later);
			}
			entry.hydrated = true;
			notify(entry);
		}
	} catch {
		for (const repoId of repoIds) {
			const entry = entryFor(repoId);
			entry.hydrated = true;
			notify(entry);
		}
	}
}

/** Subscribe and join this repository to the next page-wide hydration batch. */
export function subscribeCollectionMembership(
	repoId: number,
	listener: Listener
): () => void {
	const entry = entryFor(repoId);
	entry.listeners.add(listener);
	listener(snapshot(entry));
	if (!entry.hydrated) scheduleHydration(repoId);
	return () => entry.listeners.delete(listener);
}

/** Optimistically set one system-collection membership, rolling back on failure. */
export async function setCollectionMembership(
	repoId: number,
	kind: SystemCollectionKind,
	value: boolean
): Promise<void> {
	const entry = entryFor(repoId);
	const previous = entry[kind];
	entry.revision += 1;
	const mutationRevision = entry.mutationRevisions[kind] + 1;
	entry.mutationRevisions[kind] = mutationRevision;
	entry[kind] = value;
	entry.pending.add(kind);
	notify(entry);

	try {
		const response = await fetch(`/api/collections/${kind}/repositories/${repoId}`, {
			method: value ? 'PUT' : 'DELETE'
		});
		const body = (await response.json().catch(() => ({}))) as {
			ok?: boolean;
			error?: string;
			membership?: { favorites: boolean; watch_later: boolean };
		};
		if (!response.ok || !body.ok || !body.membership) {
			throw new Error(body.error ?? 'Unable to update saved repositories.');
		}
		if (entry.mutationRevisions[kind] === mutationRevision) {
			entry[kind] = Boolean(body.membership[kind]);
			entry.hydrated = true;
		}
	} catch (error) {
		if (entry.mutationRevisions[kind] === mutationRevision) {
			entry[kind] = previous;
		}
		throw error;
	} finally {
		if (entry.mutationRevisions[kind] === mutationRevision) {
			entry.pending.delete(kind);
		}
		notify(entry);
	}
}

export function resetCollectionMembershipsForTests(): void {
	entries.clear();
	hydrationQueue.clear();
	hydrationScheduled = false;
}
