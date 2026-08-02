import { error } from '@sveltejs/kit';
import { parseWebsiteRouteDomain } from './website-domain';

/** Parse and require a registrable domain from a route/API param. */
export function requireWebsiteRouteDomain(raw: string | undefined): string {
	const domain = parseWebsiteRouteDomain(raw);
	if (!domain) throw error(400, 'Invalid website domain');
	return domain;
}
