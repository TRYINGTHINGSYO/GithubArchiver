import { error } from '@sveltejs/kit';
import {
	getEmergingTopicDetail,
	getLatestEmergingDetectionProvenance
} from '$lib/server/emerging-topics';
import { parseTopics } from '$lib/server/db/repos';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const detail = getEmergingTopicDetail(params.key);
	if (!detail) error(404, 'Emerging topic not found');
	return {
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
		provenance: getLatestEmergingDetectionProvenance()
	};
};
