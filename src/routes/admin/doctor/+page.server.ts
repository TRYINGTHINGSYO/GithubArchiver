import { getDoctorReport } from '$lib/server/doctor';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { report: getDoctorReport() };
};
