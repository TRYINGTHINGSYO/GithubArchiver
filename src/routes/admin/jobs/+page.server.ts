import { listJobRuns } from '$lib/server/db/jobs';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const selectedId = Number(url.searchParams.get('id'));
	const jobType = url.searchParams.get('type') ?? undefined;

	return {
		jobs: listJobRuns({ limit: 100, jobType }),
		selectedId: selectedId > 0 ? selectedId : null,
		filterType: jobType ?? ''
	};
};
