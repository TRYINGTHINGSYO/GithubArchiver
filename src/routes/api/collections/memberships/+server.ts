import { json } from '@sveltejs/kit';
import { getRepositoryCollectionMemberships } from '$lib/server/db/collections';
import type { RequestHandler } from './$types';

const MAX_BATCH_SIZE = 200;

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = (await request.json().catch(() => ({}))) as { repo_ids?: unknown };
	if (!Array.isArray(body.repo_ids)) {
		return json({ ok: false, error: 'repo_ids must be an array.' }, { status: 400 });
	}

	const repoIds = [...new Set(body.repo_ids)]
		.filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0)
		.map(Number);
	if (repoIds.length === 0 || repoIds.length !== body.repo_ids.length || repoIds.length > MAX_BATCH_SIZE) {
		return json(
			{ ok: false, error: `repo_ids must contain 1-${MAX_BATCH_SIZE} unique positive integers.` },
			{ status: 400 }
		);
	}

	const memberships = getRepositoryCollectionMemberships(locals.collectionOwner, repoIds);
	return json({
		ok: true,
		memberships: repoIds.map((repoId) => ({
			repo_id: repoId,
			...(memberships.get(repoId) ?? { favorites: false, watch_later: false })
		}))
	});
};
