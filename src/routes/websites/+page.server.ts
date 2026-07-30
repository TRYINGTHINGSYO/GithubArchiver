import type { PageServerLoad } from './$types';
import { countLiveWebsites, listLiveWebsites } from '$lib/server/db/websites';

export const load: PageServerLoad = async ({ url }) => {
	const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
	const pageSize = 40;
	const offset = (page - 1) * pageSize;
	const total = countLiveWebsites();
	const sites = listLiveWebsites(pageSize, offset);
	return {
		sites,
		total,
		page,
		pageSize,
		hasMore: offset + sites.length < total
	};
};
