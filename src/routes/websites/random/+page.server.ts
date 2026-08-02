import {
	listSourceReposForWebsite,
	markWebsiteShown,
	pickRandomWebsite
} from '$lib/server/db/websites';
import {
	getUserWebsiteRating,
	getWebsiteRatingAggregate
} from '$lib/server/website-ratings';
import { getWebsiteCollectionMembership } from '$lib/server/db/collections';
import { websiteVisitHref } from '$lib/server/website-domain';
import { parseWebsiteQualityFilter } from '$lib/website-random-filters';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const minQuality = parseWebsiteQualityFilter(url.searchParams.get('min_quality'));
	// Checkbox + hidden pair may send working=0&working=1; last value wins.
	const workingValues = url.searchParams.getAll('working');
	const workingOnly =
		workingValues.length === 0 || workingValues[workingValues.length - 1] !== '0';
	const completelyRandom = url.searchParams.get('mode') === 'random';

	const owner = locals.collectionOwner;
	const site = pickRandomWebsite({
		ownerType: owner.owner_type,
		ownerKey: owner.owner_key,
		minQuality: minQuality ?? undefined,
		workingOnly,
		excludeShownHours: completelyRandom ? 0 : 24
	});

	if (site) {
		markWebsiteShown(site.registrable_domain, owner.owner_type, owner.owner_key);
	}

	const domain = site?.registrable_domain ?? null;
	const aggregate = domain ? getWebsiteRatingAggregate(domain) : null;
	const userRating = domain ? getUserWebsiteRating(domain, owner) : null;
	const membership = domain ? getWebsiteCollectionMembership(owner, domain) : null;
	const sourceRepos = domain ? listSourceReposForWebsite(domain, 8) : [];

	return {
		site,
		aggregate,
		userRating,
		membership,
		sourceRepos,
		filters: {
			minQuality,
			workingOnly,
			completelyRandom
		},
		visitHref: site ? websiteVisitHref(site) : null,
		whyInteresting: site
			? site.summary?.trim() ||
				(site.page_title
					? `Verified live site titled “${site.page_title}”.`
					: 'Verified live domain from the website discovery pipeline.')
			: null
	};
};
