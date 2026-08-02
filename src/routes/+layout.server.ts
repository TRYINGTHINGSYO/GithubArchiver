import { getDaemonActivity } from '$lib/server/daemon-activity';
import { getDb } from '$lib/server/db';
import { listHighestRatedWebsites, listLiveWebsites } from '$lib/server/db/websites';
import type { LayoutServerLoad } from './$types';

/** Keep layout load cheap — heavy stats/daemon work belongs on page or API routes. */
export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	let healthy = true;
	let activity = null;
	let railRepos: Array<{ full_name: string; interesting_score: number | null }> = [];
	let railWebsites: Array<{
		registrable_domain: string;
		page_title: string | null;
		rating_avg: number | null;
	}> = [];

	try {
		getDb().prepare('SELECT 1').get();
		activity = getDaemonActivity();
		railRepos = getDb()
			.prepare(
				`SELECT full_name, interesting_score
				 FROM repos
				 WHERE deleted_at IS NULL
				   AND pending_deletion_at IS NULL
				   AND interesting_score IS NOT NULL
				 ORDER BY interesting_score DESC
				 LIMIT 8`
			)
			.all() as Array<{ full_name: string; interesting_score: number | null }>;

		const rated = listHighestRatedWebsites(6);
		railWebsites = (rated.length > 0 ? rated : listLiveWebsites(6, 0)).map((site) => ({
			registrable_domain: site.registrable_domain,
			page_title: site.page_title,
			rating_avg: site.rating_avg ?? null
		}));
	} catch {
		healthy = false;
	}

	return {
		healthy,
		isAdmin: locals.isAdmin,
		user: user
			? {
					id: user.id,
					name: user.name,
					email: user.email,
					image: user.image,
					role: user.role,
					githubLogin: user.githubLogin
				}
			: null,
		activity,
		railRepos,
		railWebsites
	};
};
