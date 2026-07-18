import { getArchivePulse } from '$lib/server/db';
import { getDb } from '$lib/server/db/connection';
import { countMissingGhArchiveHours, latestIngestedHour } from '$lib/server/db/ingestion';
import { REPO_SORTS } from '$lib/server/db/repo-query';
import { isSearchFallbackActive } from '$lib/server/db/search-ingest';
import { getDataReadiness } from '$lib/server/data-readiness';
import {
	getActiveQualityClusters,
	getDiscoveryLanding,
	getNewHighSignalRepos
} from '$lib/server/discovery';
import { getDiscoverySystemStatus } from '$lib/server/discovery-materialized';
import { getEnrichmentProgress } from '$lib/server/enrichment-progress';
import { getEnrichmentOpsSnapshot } from '$lib/server/workers/enrich';
import {
	getLatestEmergingDetectionProvenance,
	listEmergingNearMisses,
	type EmergingNearMiss
} from '$lib/server/emerging-topics';
import { getAvailableLanguages, listRepos } from '$lib/server/repos';
import { parseRepoQueryParams, repoQueryFiltersForUi } from '$lib/server/repo-search';
import type { PageServerLoad } from './$types';

function countHighSignalRepos(): number {
	return (
		getDb()
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE COALESCE(signal_tier, 'normal') IN ('normal', 'high')
				   AND deleted_at IS NULL
				   AND interesting_score IS NOT NULL`
			)
			.get() as { c: number }
	).c;
}

function countClassifiedRepos(): number {
	return (
		getDb()
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE classified_at IS NOT NULL AND deleted_at IS NULL`
			)
			.get() as { c: number }
	).c;
}

function windowDaysFromProvenance(startIso: string | undefined, endIso: string | undefined): number {
	if (!startIso || !endIso) return 7;
	const start = Date.parse(startIso);
	const end = Date.parse(endIso);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 7;
	return Math.max(1, Math.round((end - start) / 86_400_000));
}

function isRepoSearchRequest(url: URL): boolean {
	const keys = [
		'q',
		'language',
		'category',
		'signal_tier',
		'feed',
		'sort',
		'min_stars',
		'max_stars',
		'min_forks',
		'cluster',
		'clusters',
		'deleted_only',
		'archived_only',
		'has_readme',
		'has_release',
		'never_enriched',
		'min_interesting_score',
		'date_from',
		'date_to',
		'year',
		'source',
		'page',
		'per_page'
	];
	return keys.some((key) => url.searchParams.has(key));
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const searching = isRepoSearchRequest(url);
	const opts = parseRepoQueryParams(url);
	const searchResult = searching
		? listRepos(opts)
		: { repos: [], total: 0, page: 1, perPage: 50, totalPages: 0, search_mode: 'list' as const };

	const discovery = getDiscoveryLanding({ limit: 6, minScore: 55 });
	const readiness = getDataReadiness({ windowDays: 7 });
	const archivePulse = getArchivePulse();
	const discoveryStatus = getDiscoverySystemStatus();
	const enrichmentProgress = getEnrichmentProgress();
	const enrichmentOps = getEnrichmentOpsSnapshot();
	const provenance = getLatestEmergingDetectionProvenance();
	const highSignalRepos = getNewHighSignalRepos({ limit: 8, minScore: 55 });
	const featuredRepo =
		discovery.projectsToWatch[0] ??
		highSignalRepos[0] ??
		discovery.unusualFinds[0] ??
		null;
	const activeClusterCount = discovery.clusters.filter((cluster) => cluster.repo_count > 0).length;
	const analyzedCoveragePercent =
		readiness.totalRepos > 0
			? Math.round((readiness.enrichedRepos / readiness.totalRepos) * 1000) / 10
			: 0;

	const growthClusters = discovery.fastestGrowing;
	const clusterMode = growthClusters.length > 0 ? ('growth' as const) : ('activity' as const);
	const clusterCards =
		clusterMode === 'growth'
			? growthClusters.map((cluster) => ({
					slug: cluster.slug,
					name: cluster.name,
					description: cluster.description,
					repoCount: cluster.currentWeekCount,
					secondaryCount: cluster.previousWeekCount,
					growthPercent: cluster.growthPercent as number | null,
					avgInterestingScore: cluster.avgInterestingScore,
					topLanguages: cluster.topLanguages,
					topRepos: cluster.topRepos,
					rankingReason: cluster.rankingReason,
					metricLabel: 'week-over-week growth' as const,
					// Only true for cards sourced from the verified growth endpoint.
					isVerifiedGrowth: true
				}))
			: getActiveQualityClusters({ limit: 6, minScore: 55 }).map((cluster) => ({
					slug: cluster.slug,
					name: cluster.name,
					description: cluster.description,
					repoCount: cluster.repoCount,
					secondaryCount: cluster.new7d,
					growthPercent: null as number | null,
					avgInterestingScore: cluster.avgInterestingScore,
					topLanguages: cluster.topLanguages,
					topRepos: cluster.topRepos,
					rankingReason: cluster.rankingReason,
					metricLabel: 'recent activity' as const,
					isVerifiedGrowth: false
				}));

	let nearMisses: EmergingNearMiss[] = [];
	if (
		!searching &&
		discovery.emergingTopics.length === 0 &&
		provenance?.current.datasetId &&
		provenance.previous.datasetId
	) {
		try {
			nearMisses = listEmergingNearMisses({
				currentDatasetId: provenance.current.datasetId,
				previousDatasetId: provenance.previous.datasetId,
				periodEnd: new Date(provenance.current.windowEnd),
				windowDays: windowDaysFromProvenance(
					provenance.current.windowStart,
					provenance.current.windowEnd
				),
				limit: 5,
				minCurrentCount: 3
			});
		} catch {
			nearMisses = [];
		}
	}

	return {
		searching,
		...searchResult,
		languages: searching ? getAvailableLanguages() : [],
		sorts: REPO_SORTS,
		filters: repoQueryFiltersForUi(opts),
		discovery,
		discoveryStatus,
		enrichmentProgress,
		enrichmentOps,
		latestArchiveHour: latestIngestedHour(),
		archiveHourBacklog: countMissingGhArchiveHours(),
		searchFallbackActive: isSearchFallbackActive(),
		readiness,
		archivePulse,
		provenance,
		nearMisses,
		highSignalRepos,
		featuredRepo,
		clusters: {
			mode: clusterMode,
			items: clusterCards
		},
		snapshot: {
			indexed: readiness.totalRepos,
			enriched: readiness.enrichedRepos,
			classified: discoveryStatus.classified || countClassifiedRepos(),
			clustered: readiness.clusteredRepos,
			highSignal: countHighSignalRepos(),
			emergingActive: discovery.emergingTopics.length,
			stories: readiness.storyRepos,
			activeClusters: activeClusterCount,
			analyzedCoveragePercent
		},
		isAdmin: locals.isAdmin
	};
};
