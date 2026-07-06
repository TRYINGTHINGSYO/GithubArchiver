import { getAdminStatus } from '$lib/server/admin';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		return { status: await getAdminStatus(), loadError: null as string | null };
	} catch (err) {
		return {
			status: null,
			loadError: err instanceof Error ? err.message : 'Failed to load admin status'
		};
	}
};
