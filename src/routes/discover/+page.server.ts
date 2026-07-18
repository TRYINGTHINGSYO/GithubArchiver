import { getDiscoveryLanding, parseDiscoveryQuery } from '$lib/server/discovery';
import {
	formatRelativeTime,
	getDiscoverySystemStatus
} from '$lib/server/discovery-materialized';
import { countMissingGhArchiveHours, latestIngestedHour } from '$lib/server/db/ingestion';
import { getLatestEmergingDetectionProvenance } from '$lib/server/emerging-topics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const query = parseDiscoveryQuery(url);
	const discoveryStatus = getDiscoverySystemStatus();
	const provenance = getLatestEmergingDetectionProvenance();
	return {
		query,
		discovery: getDiscoveryLanding(query),
		discoveryStatus,
		provenance,
		emergingAnalysisAgo: formatRelativeTime(
			discoveryStatus.lastEmergingAnalysisAt ?? provenance?.current.windowEnd ?? null
		),
		discoveryAnalysisAgo: formatRelativeTime(discoveryStatus.lastDiscoveryAnalysisAt),
		latestArchiveHour: latestIngestedHour(),
		archiveHourBacklog: countMissingGhArchiveHours()
	};
};
