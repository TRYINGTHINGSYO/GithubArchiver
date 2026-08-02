import { json } from '@sveltejs/kit';
import { getRepoById } from '$lib/server/db/repos';
import {
	addRepositoryToCollection,
	getRepositoryCollectionMembership,
	isSystemCollectionKind,
	removeRepositoryFromCollection
} from '$lib/server/db/collections';
import { removeSavedRepo, saveRepo } from '$lib/server/db/user-saved-repos';
import type { RequestHandler } from './$types';

type ParsedRequest =
	| { ok: true; kind: 'favorites' | 'watch_later'; repoId: number }
	| { ok: false; response: Response };

function parseRequest(params: Record<string, string | undefined>): ParsedRequest {
	const kind = params.kind ?? '';
	if (!isSystemCollectionKind(kind)) {
		return {
			ok: false,
			response: json({ ok: false, error: 'Unknown system collection.' }, { status: 404 })
		};
	}
	const repoId = Number(params.repoId);
	if (!Number.isSafeInteger(repoId) || repoId <= 0) {
		return {
			ok: false,
			response: json({ ok: false, error: 'Invalid repository ID.' }, { status: 400 })
		};
	}
	if (!getRepoById(repoId)) {
		return {
			ok: false,
			response: json({ ok: false, error: 'Repository not found.' }, { status: 404 })
		};
	}
	return { ok: true, kind, repoId };
}

export const PUT: RequestHandler = async ({ locals, params }) => {
	const parsed = parseRequest(params);
	if (!parsed.ok) return parsed.response;
	const result = addRepositoryToCollection(locals.collectionOwner, parsed.kind, parsed.repoId);
	if (locals.user) saveRepo(locals.user.id, parsed.repoId, null);
	return json({ ok: true, repo_id: parsed.repoId, membership: result.membership, created: result.created });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const parsed = parseRequest(params);
	if (!parsed.ok) return parsed.response;
	const result = removeRepositoryFromCollection(locals.collectionOwner, parsed.kind, parsed.repoId);
	if (locals.user) {
		const membership = getRepositoryCollectionMembership(locals.collectionOwner, parsed.repoId);
		if (!membership.favorites && !membership.watch_later) {
			removeSavedRepo(locals.user.id, parsed.repoId);
		}
	}
	return json({ ok: true, repo_id: parsed.repoId, membership: result.membership, removed: result.removed });
};
