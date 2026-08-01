import type { PageServerLoad } from './$types';
import {
	countLiveWebsites,
	listLiveWebsites,
	type LiveWebsiteSort
} from '$lib/server/db/websites';

function parseSort(value: string | null): LiveWebsiteSort {
	if (value === 'rated' || value === 'favorites') return value;
	return 'recent';
}

export const load: PageServerLoad = async ({ url }) => {
	const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
	const sort = parseSort(url.searchParams.get('sort'));
	const pageSize = 40;
	const offset = (page - 1) * pageSize;
	const total = countLiveWebsites();
	const sites = listLiveWebsites(pageSize, offset, sort);
	return {
		sites,
		total,
		page,
		pageSize,
		sort,
		hasMore: offset + sites.length < total
	};
};
