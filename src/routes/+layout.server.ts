import { getDaemonActivity } from '$lib/server/daemon-activity';
import { getDb } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

/** Keep layout load cheap — heavy stats/daemon work belongs on page or API routes. */
export const load: LayoutServerLoad = async ({ locals }) => {
	let healthy = true;
	let activity = null;
	try {
		getDb().prepare('SELECT 1').get();
		activity = getDaemonActivity();
	} catch {
		healthy = false;
	}

	return {
		healthy,
		isAdmin: locals.isAdmin,
		activity
	};
};
