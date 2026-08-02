import { error } from '@sveltejs/kit';
import {
	getEmergingTopicDetail,
	getLatestEmergingDetectionProvenance,
	getStaleEmergingTopicSummary
} from '$lib/server/emerging-topics';
import { parseTopics } from '$lib/server/db/repos';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const detail = getEmergingTopicDetail(params.key);
	const provenance = getLatestEmergingDetectionProvenance();
	if (!detail) {
		const staleTopic = getStaleEmergingTopicSummary(params.key);
		if (!staleTopic) error(404, 'Emerging topic not found');
		return {
			isAdmin: locals.isAdmin,
			state: 'stale' as const,
			staleTopic,
			detail: null,
			provenance
		};
	}
	return {
		isAdmin: locals.isAdmin,
		state: 'current' as const,
		detail: {
			...detail,
			repositories: detail.repositories.map((repo) => ({
				...repo,
				topics: parseTopics(repo.topics),
				github_archived: repo.github_archived === 1,
				has_readme: repo.has_readme === 1,
				has_source: repo.has_source === 1,
				has_any_archive: repo.has_any_archive === 1
			}))
		},
		staleTopic: null,
		provenance
	};
};
