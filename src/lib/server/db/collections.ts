import type { CollectionOwner } from '$lib/server/collection-owner';
import { canonicalizeCollectionOwner } from '$lib/server/collection-owner';
import { getDb } from './connection';
import { parseTopics } from './repos';

export const SYSTEM_COLLECTION_KINDS = ['favorites', 'watch_later'] as const;
export type SystemCollectionKind = (typeof SYSTEM_COLLECTION_KINDS)[number];

export interface CollectionRow {
	id: number;
	owner_type: string;
	owner_key: string;
	kind: string;
	name: string;
	slug: string;
	created_at: string;
	updated_at: string;
}

export interface CollectionMembership {
	favorites: boolean;
	watch_later: boolean;
}

export interface CollectionRepository {
	id: number;
	owner: string;
	name: string;
	full_name: string;
	created_at: string;
	first_seen_at: string;
	description: string | null;
	summary: string | null;
	language: string | null;
	stars: number | null;
	forks: number | null;
	license: string | null;
	topics: string[];
	deleted_at: string | null;
	enriched_at: string | null;
	collection_created_at: string;
	is_favorite: boolean;
	favorited_at: string | null;
}

const SYSTEM_COLLECTIONS: Record<SystemCollectionKind, { name: string; slug: string }> = {
	favorites: { name: 'Favorites', slug: 'favorites' },
	watch_later: { name: 'Watch Later', slug: 'watch-later' }
};

export function isSystemCollectionKind(value: string): value is SystemCollectionKind {
	return SYSTEM_COLLECTION_KINDS.includes(value as SystemCollectionKind);
}

function normalizedOwner(owner: CollectionOwner): CollectionOwner {
	return canonicalizeCollectionOwner(owner);
}

function findSystemCollection(owner: CollectionOwner, kind: SystemCollectionKind): CollectionRow | null {
	const normalized = normalizedOwner(owner);
	const row = getDb()
		.prepare(
			`SELECT * FROM collections
			 WHERE owner_type = ? AND owner_key = ? AND kind = ?`
		)
		.get(normalized.owner_type, normalized.owner_key, kind) as CollectionRow | undefined;
	return row ?? null;
}

export function getOrCreateSystemCollection(
	owner: CollectionOwner,
	kind: SystemCollectionKind
): CollectionRow {
	const normalized = normalizedOwner(owner);
	const definition = SYSTEM_COLLECTIONS[kind];
	const now = new Date().toISOString();
	const db = getDb();
	db.prepare(
		`INSERT OR IGNORE INTO collections
		 (owner_type, owner_key, kind, name, slug, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
	).run(
		normalized.owner_type,
		normalized.owner_key,
		kind,
		definition.name,
		definition.slug,
		now,
		now
	);

	const collection = findSystemCollection(normalized, kind);
	if (!collection) throw new Error(`Unable to create ${kind} collection.`);
	return collection;
}

/** Idempotently add a repository to a system collection. */
export function addRepositoryToCollection(
	owner: CollectionOwner,
	kind: SystemCollectionKind,
	repoId: number
): { membership: CollectionMembership; created: boolean } {
	const db = getDb();
	const result = db.transaction(() => {
		const collection = getOrCreateSystemCollection(owner, kind);
		const now = new Date().toISOString();
		const insert = db
			.prepare(
				`INSERT OR IGNORE INTO collection_repositories
				 (collection_id, repo_id, created_at) VALUES (?, ?, ?)`
			)
			.run(collection.id, repoId, now);
		if (insert.changes > 0) {
			db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(now, collection.id);
		}
		return insert.changes > 0;
	})();

	return {
		membership: getRepositoryCollectionMembership(owner, repoId),
		created: result
	};
}

/** Idempotently remove a repository from a system collection. */
export function removeRepositoryFromCollection(
	owner: CollectionOwner,
	kind: SystemCollectionKind,
	repoId: number
): { membership: CollectionMembership; removed: boolean } {
	const db = getDb();
	const removed = db.transaction(() => {
		const collection = findSystemCollection(owner, kind);
		if (!collection) return false;
		const deletion = db
			.prepare('DELETE FROM collection_repositories WHERE collection_id = ? AND repo_id = ?')
			.run(collection.id, repoId);
		if (deletion.changes > 0) {
			db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(
				new Date().toISOString(),
				collection.id
			);
		}
		return deletion.changes > 0;
	})();

	return {
		membership: getRepositoryCollectionMembership(owner, repoId),
		removed
	};
}

/** Load all requested repositories in one SQL query. */
export function getRepositoryCollectionMemberships(
	owner: CollectionOwner,
	repoIds: number[]
): Map<number, CollectionMembership> {
	const ids = [...new Set(repoIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
	const memberships = new Map<number, CollectionMembership>();
	for (const id of ids) memberships.set(id, { favorites: false, watch_later: false });
	if (ids.length === 0) return memberships;

	const normalized = normalizedOwner(owner);
	const placeholders = ids.map(() => '?').join(',');
	const rows = getDb()
		.prepare(
			`SELECT cr.repo_id, c.kind
			 FROM collection_repositories cr
			 JOIN collections c ON c.id = cr.collection_id
			 WHERE c.owner_type = ? AND c.owner_key = ?
			   AND c.kind IN ('favorites', 'watch_later')
			   AND cr.repo_id IN (${placeholders})`
		)
		.all(normalized.owner_type, normalized.owner_key, ...ids) as Array<{
			repo_id: number;
			kind: SystemCollectionKind;
		}>;

	for (const row of rows) {
		const membership = memberships.get(row.repo_id);
		if (membership) membership[row.kind] = true;
	}
	return memberships;
}

export function getRepositoryCollectionMembership(
	owner: CollectionOwner,
	repoId: number
): CollectionMembership {
	return (
		getRepositoryCollectionMemberships(owner, [repoId]).get(repoId) ?? {
			favorites: false,
			watch_later: false
		}
	);
}

export function listCollectionRepositories(
	owner: CollectionOwner,
	kind: SystemCollectionKind
): CollectionRepository[] {
	const normalized = normalizedOwner(owner);
	const rows = getDb()
		.prepare(
			`SELECT r.id, r.owner, r.name, r.full_name, r.created_at, r.first_seen_at,
			        r.description, r.summary, r.language, r.stars, r.forks, r.license,
			        r.topics, r.deleted_at, r.enriched_at,
			        cr.created_at AS collection_created_at,
			        CASE WHEN rf.repo_id IS NULL THEN 0 ELSE 1 END AS is_favorite,
			        rf.favorited_at
			 FROM collections c
			 JOIN collection_repositories cr ON cr.collection_id = c.id
			 JOIN repos r ON r.id = cr.repo_id
			 LEFT JOIN repo_favorites rf ON rf.repo_id = r.id
			 WHERE c.owner_type = ? AND c.owner_key = ? AND c.kind = ?
			 ORDER BY cr.created_at DESC, r.id DESC`
		)
		.all(normalized.owner_type, normalized.owner_key, kind) as Array<
			Omit<CollectionRepository, 'topics' | 'is_favorite'> & {
				topics: string | null;
				is_favorite: 0 | 1;
			}
		>;

	return rows.map((row) => ({
		...row,
		topics: parseTopics(row.topics),
		is_favorite: row.is_favorite === 1
	}));
}
