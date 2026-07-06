import { getStorageReport } from '$lib/server/storage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { report: getStorageReport() };
};
