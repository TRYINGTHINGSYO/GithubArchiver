import {
	countUserInterestSeeds,
	getUserEmailPreference
} from '$lib/server/db/email-preferences';
import { personalizedEmailConfigured } from '$lib/server/personalized-email';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store' });
	const user = locals.user!;
	return {
		email: user.email || null,
		preference: getUserEmailPreference(user.id),
		interestCount: countUserInterestSeeds(user.id),
		deliveryConfigured: personalizedEmailConfigured()
	};
};
