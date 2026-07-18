import { getDb } from '$lib/server/db/connection';
import { countRepos, countUnenriched } from '$lib/server/db/repos';
import { countReposByEnrichmentLevel } from '$lib/server/db/pipeline';
import { hasGitHubToken } from '$lib/server/github';
import { cached } from '$lib/server/ttl-cache';

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
	readinessReasons: string[];
	hasGitHubAuth: boolean;
};

export function getDataReadiness(opts: {
	windowDays?: number;
	periodEnd?: Date;
	minEnriched?: number;
	minOwners?: number;
} = {}): DataReadiness {
	const windowDays = opts.windowDays ?? 7;
	const periodEnd = opts.periodEnd ?? new Date();
	const minEnriched = opts.minEnriched ?? EMERGING_READY_MIN_ENRICHED;
	const minOwners = opts.minOwners ?? EMERGING_READY_MIN_OWNERS;
	// Bucket periodEnd to the minute so short TTLs actually hit across navigations.
	const periodKey = Math.floor(periodEnd.getTime() / 60_000);
	return cached(
		`data-readiness:${windowDays}:${periodKey}:${minEnriched}:${minOwners}`,
		30_000,
		() => computeDataReadiness({ windowDays, periodEnd, minEnriched, minOwners })
	);
}

function computeDataReadiness(opts: {
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

	const totalRepos = countRepos();
	const enrichmentBacklog = countUnenriched();
	const enrichedRepos = totalRepos - enrichmentBacklog;
	const enrichmentLevels = countReposByEnrichmentLevel();

	const scoredRepos = (
		db.prepare('SELECT COUNT(*) AS c FROM repos WHERE interesting_score IS NOT NULL').get() as {
			c: number;
		}
	).c;
	const clusteredRepos = (
		db.prepare('SELECT COUNT(*) AS c FROM repos WHERE clustered_at IS NOT NULL').get() as {
			c: number;
		}
	).c;
	const storyRepos = (
		db.prepare('SELECT COUNT(*) AS c FROM repos WHERE story_generated_at IS NOT NULL').get() as {
			c: number;
		}
	).c;

	const recentCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
	const recentRepos = (
		db
			.prepare('SELECT COUNT(*) AS c FROM repos WHERE created_at >= ?')
			.get(recentCutoff) as { c: number }
	).c;
	const recentEnrichedRepos = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE created_at >= ? AND enriched_at IS NOT NULL`
			)
			.get(recentCutoff) as { c: number }
	).c;

	const currentWindowRepos = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE created_at >= ? AND created_at < ?`
			)
			.get(windowStart, windowEnd) as { c: number }
	).c;
	const currentWindowEnrichedRepos = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE created_at >= ? AND created_at < ?
				   AND enriched_at IS NOT NULL`
			)
			.get(windowStart, windowEnd) as { c: number }
	).c;
	const distinctOwnersInWindow = (
		db
			.prepare(
				`SELECT COUNT(DISTINCT owner) AS c FROM repos
				 WHERE created_at >= ? AND created_at < ?
				   AND enriched_at IS NOT NULL`
			)
			.get(windowStart, windowEnd) as { c: number }
	).c;

	const previousWindowRepos = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE created_at >= ? AND created_at < ?`
			)
			.get(previousWindowStart, previousWindowEnd) as { c: number }
	).c;
	const previousWindowEnrichedRepos = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE created_at >= ? AND created_at < ?
				   AND enriched_at IS NOT NULL`
			)
			.get(previousWindowStart, previousWindowEnd) as { c: number }
	).c;
	const previousWindowDistinctOwners = (
		db
			.prepare(
				`SELECT COUNT(DISTINCT owner) AS c FROM repos
				 WHERE created_at >= ? AND created_at < ?
				   AND enriched_at IS NOT NULL`
			)
			.get(previousWindowStart, previousWindowEnd) as { c: number }
	).c;

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
		readinessReasons,
		hasGitHubAuth: hasGitHubToken()
	};
}

export function estimateEnrichmentWorkload(readiness?: DataReadiness): {
	level1Requests: number;
	level2Candidates: number;
} {
	const stats = readiness ?? getDataReadiness();
	const level1Requests = stats.enrichmentBacklog;
	// Rough candidate pool: recently enriched high-signal repos still below Level 2.
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
