import { getDiscoveryLanding, parseDiscoveryQuery } from '$lib/server/discovery';
import {
	formatRelativeTime,
	getDiscoverySystemStatus
} from '$lib/server/discovery-materialized';
import { countMissingGhArchiveHours, latestIngestedHour } from '$lib/server/db/ingestion';
import { isSearchFallbackActive } from '$lib/server/db/search-ingest';
import { getEnrichmentProgress } from '$lib/server/enrichment-progress';
import { getLatestEmergingDetectionProvenance } from '$lib/server/emerging-topics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const query = parseDiscoveryQuery(url);
	const discoveryStatus = getDiscoverySystemStatus();
	const provenance = getLatestEmergingDetectionProvenance();
	const enrichmentProgress = getEnrichmentProgress();
	return {
		query,
		discovery: getDiscoveryLanding(query),
		discoveryStatus,
		enrichmentProgress,
		provenance,
		emergingAnalysisAgo: formatRelativeTime(
			discoveryStatus.lastEmergingAnalysisAt ?? provenance?.current.windowEnd ?? null
		),
		discoveryAnalysisAgo: formatRelativeTime(discoveryStatus.lastDiscoveryAnalysisAt),
		latestArchiveHour: latestIngestedHour(),
		archiveHourBacklog: countMissingGhArchiveHours(),
		searchFallbackActive: isSearchFallbackActive()
	};
};
