import { error } from '@sveltejs/kit';
import { getWebsiteCollectionMembership } from '$lib/server/db/collections';
import {
	getWebsiteByDomain,
	incrementWebsiteView,
	listSourceReposForWebsite
} from '$lib/server/db/websites';
import {
	getUserWebsiteRating,
	getWebsiteRatingAggregate,
	listRecentWebsiteReviews
} from '$lib/server/website-ratings';
import { websiteVisitHref } from '$lib/server/website-domain';
import { requireWebsiteRouteDomain } from '$lib/server/website-route';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const domain = requireWebsiteRouteDomain(params.domain);
	const site = getWebsiteByDomain(domain);
	if (!site) throw error(404, 'Website not found');

	incrementWebsiteView(domain);

	const aggregate = getWebsiteRatingAggregate(domain);
	const userRating = getUserWebsiteRating(domain, locals.collectionOwner);
	const membership = getWebsiteCollectionMembership(locals.collectionOwner, domain);
	const reviews = listRecentWebsiteReviews(domain, 12);
	const sourceRepos = listSourceReposForWebsite(domain, 12);

	return {
		site: { ...site, view_count: (site.view_count ?? 0) + 1 },
		aggregate,
		userRating,
		membership,
		reviews,
		sourceRepos,
		visitHref: websiteVisitHref(site)
	};
};
