import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWebsiteByDomain, hideWebsiteForOwner } from '$lib/server/db/websites';

function parseDomain(param: string): string {
	return decodeURIComponent(param).trim().toLowerCase();
}

export const PUT: RequestHandler = async ({ params, locals }) => {
	const domain = parseDomain(params.domain);
	if (!getWebsiteByDomain(domain)) throw error(404, 'Website not found');
	const owner = locals.collectionOwner;
	hideWebsiteForOwner(domain, owner.owner_type, owner.owner_key, true);
	return json({ ok: true, hidden: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const domain = parseDomain(params.domain);
	if (!getWebsiteByDomain(domain)) throw error(404, 'Website not found');
	const owner = locals.collectionOwner;
	hideWebsiteForOwner(domain, owner.owner_type, owner.owner_key, false);
	return json({ ok: true, hidden: false });
};
