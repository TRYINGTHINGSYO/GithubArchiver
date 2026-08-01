import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWebsiteByDomain } from '$lib/server/db/websites';
import {
	deleteWebsiteRating,
	getWebsiteRatingAggregate,
	upsertWebsiteRating
} from '$lib/server/website-ratings';

function parseDomain(param: string): string {
	return decodeURIComponent(param).trim().toLowerCase();
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const domain = parseDomain(params.domain);
	const website = getWebsiteByDomain(domain);
	if (!website) throw error(404, 'Website not found');

	const body = (await request.json().catch(() => ({}))) as {
		rating?: number;
		review?: string | null;
	};
	const rating = Number(body.rating);
	if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
		throw error(400, 'rating must be 1–5');
	}

	try {
		const row = upsertWebsiteRating(
			domain,
			locals.collectionOwner,
			Math.round(rating),
			body.review ?? null
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
	const domain = parseDomain(params.domain);
	const website = getWebsiteByDomain(domain);
	if (!website) throw error(404, 'Website not found');

	const removed = deleteWebsiteRating(domain, locals.collectionOwner);
	return json({
		ok: true,
		removed,
		aggregate: getWebsiteRatingAggregate(domain)
	});
};
