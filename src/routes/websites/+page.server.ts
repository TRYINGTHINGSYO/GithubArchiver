import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import {
	canonicalWebsitePageUrl,
	parseWebsitePage,
	WEBSITE_PAGE_SIZE
} from '$lib/website-pagination';
import {
	countLiveWebsites,
	listLiveWebsiteCategories,
	listLiveWebsites,
	type LiveWebsiteSort
} from '$lib/server/db/websites';

function parseSort(value: string | null): LiveWebsiteSort {
	if (value === 'rated' || value === 'favorites') return value;
	return 'recent';
}

export const load: PageServerLoad = async ({ url }) => {
	const requestedPage = parseWebsitePage(url.searchParams.get('page'));
	const sort = parseSort(url.searchParams.get('sort'));
	const query = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	const category = (url.searchParams.get('category') ?? '').trim().slice(0, 80);
	const filters = {
		query: query || undefined,
		category: category || undefined
	};
	const total = countLiveWebsites(filters);
	const allTotal = query || category ? countLiveWebsites() : total;
	const totalPages = Math.max(1, Math.ceil(total / WEBSITE_PAGE_SIZE));
	const page = Math.min(requestedPage.page, totalPages);
	if (!requestedPage.valid || requestedPage.page > totalPages) {
		throw redirect(307, canonicalWebsitePageUrl(url, page));
	}
	const offset = (page - 1) * WEBSITE_PAGE_SIZE;
	const sites = listLiveWebsites(WEBSITE_PAGE_SIZE, offset, sort, filters);
	return {
		sites,
		total,
		allTotal,
		page,
		pageSize: WEBSITE_PAGE_SIZE,
		totalPages,
		sort,
		query,
		category,
		categories: listLiveWebsiteCategories(),
		hasMore: offset + sites.length < total
	};
};
