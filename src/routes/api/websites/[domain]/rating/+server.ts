import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWebsiteByDomain } from '$lib/server/db/websites';
import { requireWebsiteRouteDomain } from '$lib/server/website-route';
import {
	deleteWebsiteRating,
	getWebsiteRatingAggregate,
	upsertWebsiteRating,
	WEBSITE_REVIEW_MAX_LENGTH
} from '$lib/server/website-ratings';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const domain = requireWebsiteRouteDomain(params.domain);
	const website = getWebsiteByDomain(domain);
	if (!website) throw error(404, 'Website not found');

	const body = (await request.json().catch(() => null)) as {
		rating?: unknown;
		review?: unknown;
	} | null;
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}

	const rating = body.rating;
	if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
		throw error(400, 'rating must be an integer from 1 to 5');
	}
	if (
		body.review != null &&
		(typeof body.review !== 'string' || body.review.length > WEBSITE_REVIEW_MAX_LENGTH)
	) {
		throw error(400, `review must be a string of at most ${WEBSITE_REVIEW_MAX_LENGTH} characters`);
	}

	try {
		// Identity is the anonymous collection-owner cookie (same model as favorites).
		// Mutations are scoped to locals.collectionOwner — never another owner_key.
		const row = upsertWebsiteRating(
			domain,
			locals.collectionOwner,
			rating,
			typeof body.review === 'string' ? body.review : null
		);
		return json({
			ok: true,
			rating: row,
			aggregate: getWebsiteRatingAggregate(domain)
		});
	} catch (err) {
		throw error(400, err instanceof Error ? err.message : 'Unable to save rating');
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const domain = requireWebsiteRouteDomain(params.domain);
	const website = getWebsiteByDomain(domain);
	if (!website) throw error(404, 'Website not found');

	const removed = deleteWebsiteRating(domain, locals.collectionOwner);
	return json({
		ok: true,
		removed,
		aggregate: getWebsiteRatingAggregate(domain)
	});
};
