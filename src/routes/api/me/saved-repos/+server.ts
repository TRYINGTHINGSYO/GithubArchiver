import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth/guards';
import { listSavedRepos, removeSavedRepo, saveRepo } from '$lib/server/db/user-saved-repos';
import type { RequestHandler } from './$types';

const MAX_NOTES_LENGTH = 5_000;

function repoIdFrom(value: unknown): number | null {
	const repoId = typeof value === 'number' ? value : Number(value);
	return Number.isSafeInteger(repoId) && repoId > 0 ? repoId : null;
}

function notesFrom(value: unknown): string | null | undefined {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'string') return undefined;
	const notes = value.trim();
	if (notes.length > MAX_NOTES_LENGTH) return undefined;
	return notes || null;
}

export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	const requestedLimit = Number(event.url.searchParams.get('limit') ?? 100);
	const limit = Number.isFinite(requestedLimit) ? requestedLimit : 100;
	return json({ repos: listSavedRepos(user.id, limit) });
};

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = (await event.request.json().catch(() => null)) as
		| { repo_id?: unknown; notes?: unknown }
		| null;
	const repoId = repoIdFrom(body?.repo_id);
	const notes = notesFrom(body?.notes);
	if (!repoId) return json({ error: 'repo_id must be a positive integer' }, { status: 400 });
	if (notes === undefined) {
		return json(
			{ error: `notes must be a string of at most ${MAX_NOTES_LENGTH} characters` },
			{ status: 400 }
		);
	}
	if (!saveRepo(user.id, repoId, notes)) {
		return json({ error: 'Repository not found' }, { status: 404 });
	}
	return json({ ok: true, repo_id: repoId, notes });
};

export const DELETE: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = (await event.request.json().catch(() => null)) as { repo_id?: unknown } | null;
	const repoId = repoIdFrom(body?.repo_id);
	if (!repoId) return json({ error: 'repo_id must be a positive integer' }, { status: 400 });
	return json({ ok: true, repo_id: repoId, removed: removeSavedRepo(user.id, repoId) });
};
