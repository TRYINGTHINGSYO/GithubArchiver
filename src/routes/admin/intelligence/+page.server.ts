import { buildIntelligenceAuditReport } from '$lib/server/intelligence-audit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {
		report: buildIntelligenceAuditReport(8)
	};
};
