import {
	countReposFirstSeenSince,
	countReposByDiscoverySource,
	sumArchiveSnapshotBytes,
	countArchiveSnapshotFiles
} from '$lib/server/db/birth-feed';
import {
	countIngestedHours,
	countMetricSnapshots,
	countRepos,
	countReposDueForRefresh,
	countReposWithMetrics,
	countUnenriched,
	getLatestJobsByType,
	latestIngestedHour,
	listIngestedHours,
	listMissingHourKeys,
	listRecentJobRuns,
	parseJobDetail
} from '$lib/server/db';
import {
	countReposByYear,
	countReposArchived,
	countReposEnriched,
	countReposWithReadme,
	countReposWithReleases,
	listLatestErrors
} from '$lib/server/db/admin-stats';
import {
	getActiveBackfillJob,
	getBackfillProgress,
	getLatestBackfillJob,
	listBackfillJobs
} from '$lib/server/db/backfill';
import {
	getSearchIngestSummary,
	isSearchFallbackActive,
	listRecentSearchIngestStats
} from '$lib/server/db/search-ingest';
import { getRunningJobByType } from '$lib/server/db/jobs';
import { summarizeDaemonDecisions } from '$lib/server/db/daemon-decisions';
import { getBackupSummary } from '$lib/server/backup';
import { fetchGitHubRateLimit } from '$lib/server/github';
import { defaultHourKey } from '$lib/server/gharchive';
import { getBackgroundDaemonState } from '$lib/server/background-daemon';
import { getCurrentJobLabel, isJobRunnerBusy } from '$lib/server/job-runner';
import { getDaemonUiStatus } from '$lib/server/worker-control';
import { isMetadataOnlyMode } from '$lib/server/runtime-mode';
import { getDiscoverySystemStatus } from '$lib/server/discovery-materialized';
import { listScheduledJobs } from '$lib/server/db/scheduled-jobs';
import { getEnrichmentOpsSnapshot } from '$lib/server/workers/enrich';

const REFRESH_INTERVAL_HOURS = Number(process.env.REFRESH_INTERVAL_HOURS ?? 24);

function startOfUtcDay(): string {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function getAdminStatus() {
	const metadataOnly = isMetadataOnlyMode();
	const daemon = getDaemonUiStatus();
	const refreshJob = getLatestJobsByType().refresh;
	const refreshDetail = refreshJob ? parseJobDetail(refreshJob) : null;
	const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
	const backfillJob = getActiveBackfillJob() ?? getLatestBackfillJob();
	const rateLimit = await fetchGitHubRateLimit().catch(() => null);

	let backfill = null as null | {
		job: NonNullable<typeof backfillJob>;
		progress: ReturnType<typeof getBackfillProgress>;
	};

	if (backfillJob) {
		backfill = {
			job: backfillJob,
			progress: getBackfillProgress(backfillJob.id)
		};
	}

	const currentJob = listRecentJobRuns(1)[0] ?? null;

	return {
		daemon,
		backgroundWorker: {
			...getBackgroundDaemonState(),
			jobRunnerBusy: isJobRunnerBusy(),
			currentJob: getCurrentJobLabel()
		},
		currentJob,
		workers: getLatestJobsByType(),
		recentJobs: listRecentJobRuns(40),
		ingestion: {
			latestHour: latestIngestedHour(),
			targetHour: defaultHourKey(),
			missingHours: listMissingHourKeys(20),
			recentHours: listIngestedHours(20),
			totalHours: countIngestedHours(),
			reposLastHour: countReposFirstSeenSince(oneHourAgo),
			reposToday: countReposFirstSeenSince(startOfUtcDay()),
			workerLastRanAt: (() => {
				const ingest = getLatestJobsByType().ingest;
				if (!ingest) return null;
				return ingest.finished_at ?? ingest.started_at;
			})(),
			ingestRunning: Boolean(getRunningJobByType('ingest'))
		},
		archive: {
			metadataOnly,
			fileCount: countArchiveSnapshotFiles(),
			indexedBytes: sumArchiveSnapshotBytes()
		},
		discovery: {
			/** Lifetime count of repos whose discovery_source is github_search — not live Search. */
			githubSearchRepos: countReposByDiscoverySource('github_search'),
			searchFallbackActive: isSearchFallbackActive()
		},
		refresh: {
			intervalHours: REFRESH_INTERVAL_HOURS,
			dueCount: countReposDueForRefresh(),
			totalSnapshots: countMetricSnapshots(),
			reposWithSnapshots: countReposWithMetrics(),
			lastJob: refreshJob,
			lastDetail: refreshDetail
		},
		stats: {
			totalRepos: countRepos(),
			unenrichedRepos: countUnenriched(),
			enrichedRepos: countReposEnriched(),
			archivedRepos: countReposArchived(),
			readmeRepos: countReposWithReadme(),
			releaseRepos: countReposWithReleases(),
			reposByYear: countReposByYear()
		},
		backfill,
		backfillJobs: listBackfillJobs(10),
		searchIngest: {
			recent: listRecentSearchIngestStats(15),
			summary: getSearchIngestSummary()
		},
		rateLimit,
		latestErrors: listLatestErrors(10),
		backup: getBackupSummary(),
		daemonDecisions: summarizeDaemonDecisions(24),
		pipeline: {
			discoveryStatus: getDiscoverySystemStatus(),
			scheduledJobs: listScheduledJobs(),
			enrichment: getEnrichmentOpsSnapshot()
		}
	};
}

export type AdminStatus = Awaited<ReturnType<typeof getAdminStatus>>;
