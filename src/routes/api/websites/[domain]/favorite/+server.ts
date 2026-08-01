import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	addWebsiteToCollection,
	getWebsiteCollectionMembership,
	removeWebsiteFromCollection
} from '$lib/server/db/collections';
import { getWebsiteByDomain } from '$lib/server/db/websites';

function parseDomain(param: string): string {
	return decodeURIComponent(param).trim().toLowerCase();
}

export const PUT: RequestHandler = async ({ params, locals }) => {
	const domain = parseDomain(params.domain);
	if (!getWebsiteByDomain(domain)) throw error(404, 'Website not found');
	const result = addWebsiteToCollection(locals.collectionOwner, 'favorites', domain);
	return json({
		ok: true,
		favorited: true,
		membership: result.membership,
		created: result.created
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const domain = parseDomain(params.domain);
	if (!getWebsiteByDomain(domain)) throw error(404, 'Website not found');
	const result = removeWebsiteFromCollection(locals.collectionOwner, 'favorites', domain);
	return json({
		ok: true,
		favorited: false,
		membership: result.membership,
		removed: result.removed
	});
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const domain = parseDomain(params.domain);
	if (!getWebsiteByDomain(domain)) throw error(404, 'Website not found');
	return json({
		ok: true,
		membership: getWebsiteCollectionMembership(locals.collectionOwner, domain)
	});
};
