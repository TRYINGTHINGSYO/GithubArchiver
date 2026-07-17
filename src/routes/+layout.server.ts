import { getDb } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

/** Keep layout load cheap — heavy stats/daemon work belongs on page or API routes. */
export const load: LayoutServerLoad = async ({ locals }) => {
	let healthy = true;
	try {
		getDb().prepare('SELECT 1').get();
	} catch {
		healthy = false;
	}

	return {
		healthy,
		isAdmin: locals.isAdmin
	};
};
