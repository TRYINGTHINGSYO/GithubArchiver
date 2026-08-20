import { json } from '@sveltejs/kit';
import { getRepoBySlug } from '$lib/server/db';
import { findSimilarRepositories } from '$lib/server/semantic/similar';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	const repo = getRepoBySlug(params.owner, params.repo);
	if (!repo) {
		return json({ error: 'not found' }, { status: 404 });
	}
	const limitRaw = Number(url.searchParams.get('limit') ?? 8);
	const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(24, Math.floor(limitRaw))) : 8;
	const similar = await findSimilarRepositories(repo.id, limit);
	return json({
		repo_id: repo.id,
		similar: similar.map((item) => ({
			id: item.repo.id,
			owner: item.repo.owner,
			name: item.repo.name,
			full_name: item.repo.full_name,
			description: item.repo.description,
			language: item.repo.language,
			stars: item.repo.stars,
			category: item.repo.category,
			semantic_score: item.semanticScore
		}))
	});
};
