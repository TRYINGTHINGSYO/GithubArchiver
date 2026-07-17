import { error, json } from '@sveltejs/kit';
import { getArchiveStoryForRepo } from '$lib/server/archive-story';
import { CURRENT_STORY_VERSION } from '$lib/server/archive-story-types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const repoId = Number(params.id);
	if (!Number.isFinite(repoId) || repoId <= 0) error(400, 'Invalid repository id');

	const regenerate = url.searchParams.get('regenerate') === '1';
	const result = getArchiveStoryForRepo(repoId, {
		regenerate,
		version: CURRENT_STORY_VERSION
	});
	if (!result) error(404, 'Repository not found');

	return json({
		story: result.story,
		facts: result.facts,
		version: result.version,
		generatedAt: result.generatedAt
	});
};
