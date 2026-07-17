import { error, json } from '@sveltejs/kit';
import { getRepoClusters } from '$lib/server/clusters';
import { getRepoById } from '$lib/server/db/repos';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const repoId = Number(params.id);
	if (!Number.isFinite(repoId) || repoId <= 0) error(400, 'Invalid repository id');

	const repo = getRepoById(repoId);
	if (!repo) error(404, 'Repository not found');

	const clusters = getRepoClusters(repoId).map((membership) => ({
		slug: membership.slug,
		name: membership.name,
		confidence: membership.confidence,
		evidence: JSON.parse(membership.evidence_json),
		clustered_at: membership.clustered_at
	}));

	return json({ repo_id: repoId, full_name: repo.full_name, clusters });
};
