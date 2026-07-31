import { getDb } from '$lib/server/db/connection';
import { countRepos, countUnenriched } from '$lib/server/db/repos';
import { countReposByEnrichmentLevel } from '$lib/server/db/pipeline';
import { MIN_COMPARABLE_HOUR_COVERAGE, getWindowHourCoverage } from '$lib/server/emerging-topics';
import { hasGitHubToken } from '$lib/server/github';
import { cached } from '$lib/server/ttl-cache';
import {
	getPublishedHomepageReadinessSnapshot,
	isHomepageReadinessSnapshotFresh,
	readHomepageSourceWatermarks
} from './homepage-readiness-materialization.js';

export const EMERGING_READY_MIN_ENRICHED = 250;
export const EMERGING_READY_MIN_OWNERS = 50;

export type DataReadiness = {
	totalRepos: number;
	enrichedRepos: number;
	scoredRepos: number;
	clusteredRepos: number;
	storyRepos: number;
	enrichmentBacklog: number;
	enrichmentLevels: Record<number, number>;
	recentRepos: number;
	recentEnrichedRepos: number;
	currentWindowRepos: number;
	currentWindowEnrichedRepos: number;
	distinctOwnersInWindow: number;
	previousWindowStart: string;
	previousWindowEnd: string;
	previousWindowRepos: number;
	previousWindowEnrichedRepos: number;
	previousWindowDistinctOwners: number;
	windowStart: string;
	windowEnd: string;
	emergingDetectionReady: boolean;
	/** Detection can run but week-over-week growth is suppressed until both windows are near-fully ingested. */
	growthComparisonReady: boolean;
	currentWindowHoursExpected: number;
	currentWindowHoursProcessed: number;
	previousWindowHoursProcessed: number;
	readinessReasons: string[];
	hasGitHubAuth: boolean;
};

export function getDataReadiness(opts: {
	windowDays?: number;
	periodEnd?: Date;
	minEnriched?: number;
	minOwners?: number;
	/** Force live compute (materializer / tests). */
	forceLive?: boolean;
} = {}): DataReadiness {
	const windowDays = opts.windowDays ?? 7;
	const periodEnd = opts.periodEnd ?? new Date();
	const minEnriched = opts.minEnriched ?? EMERGING_READY_MIN_ENRICHED;
	const minOwners = opts.minOwners ?? EMERGING_READY_MIN_OWNERS;

	if (!opts.forceLive) {
		const snapshot = getPublishedHomepageReadinessSnapshot();
		if (
			snapshot &&
			snapshot.windowDays === windowDays &&
			isHomepageReadinessSnapshotFresh(snapshot)
		) {
			return snapshot.readiness;
		}
	}

	// Bucket periodEnd to the minute so short TTLs actually hit across navigations.
	const periodKey = Math.floor(periodEnd.getTime() / 60_000);
	return cached(
		`data-readiness:${windowDays}:${periodKey}:${minEnriched}:${minOwners}`,
		30_000,
		() => computeDataReadiness({ windowDays, periodEnd, minEnriched, minOwners })
	);
}

/**
 * Live readiness compute. Batches compatible aggregate counts and reuses
 * discovery_system_status corpus counters when their semantics match exactly.
 */
export function computeDataReadiness(opts: {
	windowDays: number;
	periodEnd: Date;
	minEnriched: number;
	minOwners: number;
}): DataReadiness {
	const db = getDb();
	const { windowDays, periodEnd, minEnriched, minOwners } = opts;
	const periodStart = new Date(periodEnd.getTime() - windowDays * 86_400_000);
	const previousStart = new Date(periodStart.getTime() - windowDays * 86_400_000);
	const windowStart = periodStart.toISOString();
	const windowEnd = periodEnd.toISOString();
	const previousWindowStart = previousStart.toISOString();
	const previousWindowEnd = periodStart.toISOString();

	const corpus = readCorpusCounts();
	const totalRepos = corpus.totalRepos;
	const enrichmentBacklog = corpus.enrichmentBacklog;
	const enrichedRepos = corpus.enrichedRepos;
	const enrichmentLevels = countReposByEnrichmentLevel();

	const pipelineCounts = db
		.prepare(
			`SELECT
			   SUM(CASE WHEN interesting_score IS NOT NULL THEN 1 ELSE 0 END) AS scored,
			   SUM(CASE WHEN clustered_at IS NOT NULL THEN 1 ELSE 0 END) AS clustered,
			   SUM(CASE WHEN story_generated_at IS NOT NULL THEN 1 ELSE 0 END) AS story
			 FROM repos`
		)
		.get() as { scored: number | null; clustered: number | null; story: number | null };
	const scoredRepos = pipelineCounts.scored ?? 0;
	const clusteredRepos = pipelineCounts.clustered ?? 0;
	const storyRepos = pipelineCounts.story ?? 0;

	const recentCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
	const recent = db
		.prepare(
			`SELECT
			   COUNT(*) AS repos,
			   SUM(CASE WHEN enriched_at IS NOT NULL THEN 1 ELSE 0 END) AS enriched
			 FROM repos
			 WHERE created_at >= ?`
		)
		.get(recentCutoff) as { repos: number; enriched: number | null };
	const recentRepos = recent.repos;
	const recentEnrichedRepos = recent.enriched ?? 0;

	const currentWindow = db
		.prepare(
			`SELECT
			   COUNT(*) AS repos,
			   SUM(CASE WHEN enriched_at IS NOT NULL THEN 1 ELSE 0 END) AS enriched,
			   COUNT(DISTINCT CASE WHEN enriched_at IS NOT NULL THEN owner END) AS owners
			 FROM repos
			 WHERE created_at >= ? AND created_at < ?`
		)
		.get(windowStart, windowEnd) as {
		repos: number;
		enriched: number | null;
		owners: number | null;
	};
	const currentWindowRepos = currentWindow.repos;
	const currentWindowEnrichedRepos = currentWindow.enriched ?? 0;
	const distinctOwnersInWindow = currentWindow.owners ?? 0;

	const previousWindow = db
		.prepare(
			`SELECT
			   COUNT(*) AS repos,
			   SUM(CASE WHEN enriched_at IS NOT NULL THEN 1 ELSE 0 END) AS enriched,
			   COUNT(DISTINCT CASE WHEN enriched_at IS NOT NULL THEN owner END) AS owners
			 FROM repos
			 WHERE created_at >= ? AND created_at < ?`
		)
		.get(previousWindowStart, previousWindowEnd) as {
		repos: number;
		enriched: number | null;
		owners: number | null;
	};
	const previousWindowRepos = previousWindow.repos;
	const previousWindowEnrichedRepos = previousWindow.enriched ?? 0;
	const previousWindowDistinctOwners = previousWindow.owners ?? 0;

	const readinessReasons: string[] = [];
	if (currentWindowEnrichedRepos < minEnriched) {
		readinessReasons.push(
			`${currentWindowEnrichedRepos.toLocaleString()} repositories are enriched in the selected period, while ${minEnriched.toLocaleString()} are required.`
		);
	}
	if (distinctOwnersInWindow < minOwners) {
		readinessReasons.push(
			`${distinctOwnersInWindow.toLocaleString()} distinct owners are enriched in the period, while ${minOwners.toLocaleString()} are required.`
		);
	}
	if (previousWindowEnrichedRepos < minEnriched) {
		readinessReasons.push(
			`${previousWindowEnrichedRepos.toLocaleString()} repositories are enriched in the previous comparison window (${previousWindowStart.slice(0, 10)} → ${previousWindowEnd.slice(0, 10)}), while ${minEnriched.toLocaleString()} are required for meaningful growth comparisons.`
		);
	}
	if (previousWindowDistinctOwners < minOwners) {
		readinessReasons.push(
			`${previousWindowDistinctOwners.toLocaleString()} distinct owners are enriched in the previous window, while ${minOwners.toLocaleString()} are required.`
		);
	}
	if (!hasGitHubToken()) {
		readinessReasons.push(
			'GITHUB_TOKEN is not set — enrichment is limited to 60 requests/hour.'
		);
	}
	if (enrichmentBacklog > 0 && recentEnrichedRepos < 500) {
		readinessReasons.push(
			`Enrichment backlog is ${enrichmentBacklog.toLocaleString()} repositories; prioritize recent Level-1 enrichment before raising detection thresholds.`
		);
	}

	const currentHourCoverage = getWindowHourCoverage(windowStart, windowEnd);
	const previousHourCoverage = getWindowHourCoverage(previousWindowStart, previousWindowEnd);
	const growthComparisonReady =
		currentHourCoverage.ratio >= MIN_COMPARABLE_HOUR_COVERAGE &&
		previousHourCoverage.ratio >= MIN_COMPARABLE_HOUR_COVERAGE;

	if (!growthComparisonReady) {
		const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
		readinessReasons.push(
			`Growth comparison is suppressed: the current window has ${currentHourCoverage.hoursProcessed}/${currentHourCoverage.hoursExpected} hours ingested (${pct(currentHourCoverage.ratio)}) and the previous window ${previousHourCoverage.hoursProcessed}/${previousHourCoverage.hoursExpected} (${pct(previousHourCoverage.ratio)}), while ${pct(MIN_COMPARABLE_HOUR_COVERAGE)} is required. Emerging topics will still be detected, but without week-over-week growth.`
		);
	}

	const emergingDetectionReady =
		currentWindowEnrichedRepos >= minEnriched && distinctOwnersInWindow >= minOwners;

	return {
		totalRepos,
		enrichedRepos,
		scoredRepos,
		clusteredRepos,
		storyRepos,
		enrichmentBacklog,
		enrichmentLevels,
		recentRepos,
		recentEnrichedRepos,
		currentWindowRepos,
		currentWindowEnrichedRepos,
		distinctOwnersInWindow,
		previousWindowStart,
		previousWindowEnd,
		previousWindowRepos,
		previousWindowEnrichedRepos,
		previousWindowDistinctOwners,
		windowStart,
		windowEnd,
		emergingDetectionReady,
		growthComparisonReady,
		currentWindowHoursExpected: currentHourCoverage.hoursExpected,
		currentWindowHoursProcessed: currentHourCoverage.hoursProcessed,
		previousWindowHoursProcessed: previousHourCoverage.hoursProcessed,
		readinessReasons,
		hasGitHubAuth: hasGitHubToken()
	};
}

/**
 * Prefer discovery_system_status corpus counters when present — they match
 * total / enriched / clustered semantics used by readiness. Fall back to scans.
 */
function readCorpusCounts(): {
	totalRepos: number;
	enrichedRepos: number;
	enrichmentBacklog: number;
} {
	const db = getDb();
	const hasStatus = Boolean(
		db
			.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
			.get('discovery_system_status')
	);
	if (hasStatus) {
		const status = db
			.prepare(
				`SELECT repositories_discovered, enriched, clustered, updated_at
				 FROM discovery_system_status WHERE id = 1`
			)
			.get() as
			| {
					repositories_discovered: number;
					enriched: number;
					clustered: number;
					updated_at: string;
			  }
			| undefined;
		if (status && status.repositories_discovered > 0) {
			const totalRepos = status.repositories_discovered;
			const enrichedRepos = Math.min(status.enriched, totalRepos);
			return {
				totalRepos,
				enrichedRepos,
				enrichmentBacklog: Math.max(0, totalRepos - enrichedRepos)
			};
		}
	}

	const totalRepos = countRepos();
	const enrichmentBacklog = countUnenriched();
	return {
		totalRepos,
		enrichedRepos: totalRepos - enrichmentBacklog,
		enrichmentBacklog
	};
}

export function estimateEnrichmentWorkload(readiness?: DataReadiness): {
	level1Requests: number;
	level2Candidates: number;
} {
	const stats = readiness ?? getDataReadiness();
	const level1Requests = stats.enrichmentBacklog;
	const db = getDb();
	const level2Candidates = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE enriched_at IS NOT NULL
				   AND enrichment_level < 2
				   AND deleted_at IS NULL
				   AND (
				     COALESCE(interesting_score, 0) >= 55
				     OR COALESCE(category_confidence, 1) < 0.55
				     OR signal_tier = 'high'
				     OR deleted_at IS NOT NULL
				   )`
			)
			.get() as { c: number }
	).c;
	return { level1Requests, level2Candidates };
}

/** Expose watermarks for tests / MCP without importing the materialization module everywhere. */
export function getHomepageReadinessSourceWatermarks() {
	return readHomepageSourceWatermarks();
}
