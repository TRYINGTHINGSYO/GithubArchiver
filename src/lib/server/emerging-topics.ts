import { CLUSTER_DEFINITIONS } from '$lib/server/cluster-registry';
import { getDb } from '$lib/server/db/connection';
import { parseTopics } from '$lib/server/db/repos';
import type { RepoRow } from '$lib/server/db/types';
import {
	evaluateDatasetComparability,
	getDatasetRun,
	refreshDatasetEnrichmentCounts
} from '$lib/server/dataset-runs';
import type { BackfillDatasetRun } from '$lib/server/dataset-runs';

export const CURRENT_EMERGING_DETECTION_VERSION = 1;

export type EmergingCandidateType = 'topic' | 'name-token' | 'phrase' | 'dependency' | 'technology';
export type EmergingTopicStatus = 'detected' | 'reviewing' | 'promoted' | 'dismissed' | 'expired';

export const EMERGING_REVIEW_REASONS = [
	'valid-trend',
	'generic-term',
	'alias-duplicate',
	'curated-cluster-overlap',
	'coursework-flood',
	'template-flood',
	'single-event',
	'insufficient-quality',
	'other'
] as const;

export type EmergingReviewReason = (typeof EMERGING_REVIEW_REASONS)[number];

export interface EmergingCandidateHistory {
	currentCount: number;
	previousCount: number;
	fourWeekAverage: number;
	allTimeCount: number;
	firstSeenAt: string;
	consecutiveGrowthPeriods: number;
}

export type EmergingIngestionSource = 'gharchive' | 'github-search' | 'mixed' | 'unknown';

export const DETECTION_DEDUPLICATION_VERSION = 1;
export const MIN_COMPARABLE_HOUR_COVERAGE = 0.9;

export interface DetectionWindowMetadata {
	windowStart: string;
	windowEnd: string;
	ingestionSource: EmergingIngestionSource;
	totalObservedRepos: number;
	enrichedRepos: number;
	enrichedCoverage: number;
	hoursExpected: number;
	hoursProcessed: number;
	deduplicationVersion: number;
	datasetId?: number | null;
	queryVersion?: number | null;
	shardingVersion?: number | null;
	samplingVersion?: number | null;
	constructionVersion?: number | null;
	candidatePoolSize?: number | null;
	expectedShards?: number | null;
	completedShards?: number | null;
	partialShards?: number | null;
	failedShards?: number | null;
	sampledRepos?: number | null;
	comparisonMode?: 'absolute' | 'full-window' | 'matched-hours' | null;
	comparisonLabel?: string | null;
}

export interface DetectionComparability {
	comparable: boolean;
	growthSuppressedReason: string | null;
	current: DetectionWindowMetadata;
	previous: DetectionWindowMetadata;
	comparisonLabel: string | null;
}

export interface EmergingDetectionRules {
	aliases: Map<string, string>;
	exclusions: Set<string>;
}

export interface EmergingCandidate {
	key: string;
	label: string;
	candidateType: EmergingCandidateType;
	currentCount: number;
	previousCount: number;
	growthPercent: number | null;
	currentPrevalence: number;
	previousPrevalence: number;
	prevalenceLiftPercent: number | null;
	repoIds: number[];
	categories: Record<string, number>;
	languages: Record<string, number>;
	averageInterestingScore: number;
	highSignalCount: number;
	lowSignalCount: number;
	distinctOwnerCount: number;
	noveltyScore: number;
	momentumScore: number | null;
	qualityScore: number;
	ownerDiversityScore: number;
	categoryDiversityScore: number;
	emergingScore: number;
	growthSuppressedReason: string | null;
	history: EmergingCandidateHistory;
	evidence: EmergingCandidateEvidence;
}

export interface EmergingCandidateEvidence {
	currentRepoIds: number[];
	previousRepoIds: number[];
	exampleRepos: Array<{
		id: number;
		fullName: string;
		owner: string;
		interestingScore: number | null;
		signalTier: string | null;
	}>;
	categories: Record<string, number>;
	languages: Record<string, number>;
	scoreBreakdown: {
		momentum: number | null;
		novelty: number;
		quality: number;
		ownerDiversity: number;
		categoryDiversity: number;
		penalties: number;
	};
	growthSuppressedReason?: string | null;
	prevalence: {
		current: number;
		previous: number;
		liftPercent: number | null;
	};
	ratios: {
		lowSignal: number;
		singleOwnerShare: number;
		schoolAssignmentShare: number;
		duplicateName: number;
	};
	sources: Partial<Record<EmergingCandidateType, number>>;
	aliasHits: Record<string, number>;
}

export interface EmergingTopicRow {
	id: number;
	key: string;
	label: string;
	candidate_type: EmergingCandidateType;
	status: EmergingTopicStatus;
	period_start: string;
	period_end: string;
	current_count: number;
	previous_count: number;
	distinct_owner_count: number;
	average_interesting_score: number | null;
	novelty_score: number;
	momentum_score: number;
	quality_score: number;
	emerging_score: number;
	evidence_json: string;
	detection_version: number;
	generated_at: string;
	review_reason: EmergingReviewReason | null;
	reviewed_at: string | null;
	history_json: string | null;
}

export interface EmergingTopicRepositoryRow extends RepoRow {
	relevance: number;
	match_evidence_json: string | null;
	has_readme: 0 | 1;
	has_source: 0 | 1;
	has_any_archive: 0 | 1;
}

export interface EmergingTopicDetail {
	topic: EmergingTopicRow;
	evidence: EmergingCandidateEvidence;
	history: EmergingCandidateHistory | null;
	repositories: EmergingTopicRepositoryRow[];
}

const MIN_CURRENT_COUNT = 10;
const MIN_HIGH_SIGNAL_COUNT = 3;
const MIN_DISTINCT_OWNERS = 5;

const STOPWORDS = new Set([
	'a',
	'an',
	'and',
	'app',
	'application',
	'api',
	'bot',
	'code',
	'demo',
	'dev',
	'example',
	'github',
	'hello',
	'homework',
	'lab',
	'main',
	'new',
	'project',
	'repo',
	'site',
	'starter',
	'test',
	'tool',
	'tools',
	'web',
	'website'
]);

const COMMON_TECH = new Set([
	'android',
	'api',
	'css',
	'django',
	'docker',
	'express',
	'fastapi',
	'flask',
	'go',
	'html',
	'java',
	'javascript',
	'nextjs',
	'node',
	'python',
	'react',
	'rust',
	'svelte',
	'tailwind',
	'typescript',
	'vite',
	'vue'
]);

const CURATED_TERMS = new Set(
	CLUSTER_DEFINITIONS.flatMap((def) => [
		def.slug,
		...def.slug.split('-'),
		...def.name.toLowerCase().split(/\W+/),
		...(def.topicPatterns ?? [])
	]).map(normalizeKey)
);

type CandidateBucket = {
	key: string;
	label: string;
	candidateType: EmergingCandidateType;
	currentRepoIds: Set<number>;
	previousRepoIds: Set<number>;
	owners: Map<string, number>;
	categories: Map<string, number>;
	languages: Map<string, number>;
	scoreSum: number;
	scoredCount: number;
	highSignalCount: number;
	lowSignalCount: number;
	nameCounts: Map<string, number>;
	sources: Map<EmergingCandidateType, number>;
	aliasHits: Map<string, number>;
	earliestCurrentCreatedAt: string | null;
	exampleRepos: EmergingCandidateEvidence['exampleRepos'];
};

type ExtractedCandidate = {
	key: string;
	label: string;
	candidateType: EmergingCandidateType;
	aliasedFrom?: string;
};

type HistoryEntry = {
	total: number;
	firstSeenAt: string | null;
	windowCounts: [number, number, number, number];
};

const HISTORY_WINDOWS = 4;

export function loadEmergingDetectionRules(): EmergingDetectionRules {
	const db = getDb();
	const aliasRows = db
		.prepare('SELECT alias, canonical_key FROM emerging_term_aliases')
		.all() as { alias: string; canonical_key: string }[];
	const exclusionRows = db
		.prepare('SELECT term FROM emerging_term_exclusions')
		.all() as { term: string }[];
	return {
		aliases: new Map(aliasRows.map((row) => [row.alias, row.canonical_key])),
		exclusions: new Set(exclusionRows.map((row) => row.term))
	};
}

function isoToHourKey(iso: string): string {
	return `${iso.slice(0, 10)}-${iso.slice(11, 13)}`;
}

function normalizeIngestionSource(raw: string): EmergingIngestionSource {
	if (raw === 'gharchive') return 'gharchive';
	if (raw === 'github_search' || raw === 'github-search') return 'github-search';
	if (raw === 'gharchive+github_search') return 'mixed';
	return 'unknown';
}

/** Provenance for one detection window: where its repos came from and how completely the hours were ingested. */
export function getDetectionWindowMetadata(windowStart: string, windowEnd: string): DetectionWindowMetadata {
	const db = getDb();

	const rows = db
		.prepare(
			`SELECT COALESCE(discovery_source, 'unknown') AS src,
			        COUNT(*) AS c,
			        SUM(CASE WHEN enriched_at IS NOT NULL THEN 1 ELSE 0 END) AS e
			 FROM repos
			 WHERE created_at >= ? AND created_at < ?
			 GROUP BY src`
		)
		.all(windowStart, windowEnd) as { src: string; c: number; e: number }[];

	const totalObservedRepos = rows.reduce((sum, row) => sum + row.c, 0);
	const enrichedRepos = rows.reduce((sum, row) => sum + (row.e ?? 0), 0);

	let ingestionSource: EmergingIngestionSource = 'unknown';
	if (totalObservedRepos > 0) {
		const dominant = rows.reduce((a, b) => (b.c > a.c ? b : a));
		// A window counts as single-source when one source contributed >= 90% of repos.
		ingestionSource =
			dominant.c / totalObservedRepos >= 0.9 ? normalizeIngestionSource(dominant.src) : 'mixed';
	}

	const startKey = isoToHourKey(windowStart);
	const endKey = isoToHourKey(windowEnd);
	const hoursExpected = Math.max(
		0,
		Math.round((Date.parse(windowEnd) - Date.parse(windowStart)) / 3_600_000)
	);
	const hoursProcessed = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM (
				   SELECT hour_key FROM ingestion_state WHERE hour_key >= ? AND hour_key < ?
				   UNION
				   SELECT hour_key FROM search_ingest_stats
				   WHERE hour_key >= ? AND hour_key < ? AND status = 'completed'
				 )`
			)
			.get(startKey, endKey, startKey, endKey) as { c: number }
	).c;

	return {
		windowStart,
		windowEnd,
		ingestionSource,
		totalObservedRepos,
		enrichedRepos,
		enrichedCoverage:
			totalObservedRepos > 0 ? Math.round((enrichedRepos / totalObservedRepos) * 1000) / 1000 : 0,
		hoursExpected,
		hoursProcessed,
		deduplicationVersion: DETECTION_DEDUPLICATION_VERSION
	};
}

/**
 * Growth/momentum figures are only meaningful when both windows were ingested
 * the same way with near-complete hour coverage. Otherwise week-over-week
 * changes mostly measure the sampling difference, not the ecosystem.
 */
export function evaluateWindowComparability(
	current: DetectionWindowMetadata,
	previous: DetectionWindowMetadata
): DetectionComparability {
	const coverageRatio = (meta: DetectionWindowMetadata) =>
		meta.hoursExpected > 0 ? meta.hoursProcessed / meta.hoursExpected : 0;

	let growthSuppressedReason: string | null = null;

	const hasDatasetPlan =
		current.datasetId != null &&
		previous.datasetId != null &&
		current.queryVersion != null &&
		previous.queryVersion != null;

	if (hasDatasetPlan) {
		if (
			current.ingestionSource !== previous.ingestionSource ||
			current.queryVersion !== previous.queryVersion ||
			current.shardingVersion !== previous.shardingVersion ||
			current.deduplicationVersion !== previous.deduplicationVersion ||
			current.samplingVersion !== previous.samplingVersion ||
			current.constructionVersion !== previous.constructionVersion ||
			current.candidatePoolSize !== previous.candidatePoolSize
		) {
			growthSuppressedReason = 'different-sampling-plans';
		} else {
			const currentCompleted =
				(current.expectedShards ?? 0) > 0
					? (current.completedShards ?? 0) / (current.expectedShards ?? 1)
					: 0;
			const previousCompleted =
				(previous.expectedShards ?? 0) > 0
					? (previous.completedShards ?? 0) / (previous.expectedShards ?? 1)
					: 0;
			if (currentCompleted < 0.9 || previousCompleted < 0.9) {
				growthSuppressedReason = 'incomplete-search-shards';
			} else if ((current.partialShards ?? 0) > 0 || (previous.partialShards ?? 0) > 0) {
				growthSuppressedReason = 'partial-search-results';
			} else {
				const sampleRatio =
					(previous.sampledRepos ?? 0) > 0
						? (current.sampledRepos ?? 0) / (previous.sampledRepos ?? 1)
						: null;
				if (sampleRatio == null || sampleRatio < 0.8 || sampleRatio > 1.25) {
					growthSuppressedReason = 'sample-size-imbalance';
				} else if (Math.abs(current.enrichedCoverage - previous.enrichedCoverage) > 0.1) {
					growthSuppressedReason = 'enrichment-coverage-imbalance';
				}
			}
		}
	} else if (
		current.ingestionSource === 'unknown' ||
		previous.ingestionSource === 'unknown' ||
		current.ingestionSource === 'mixed' ||
		previous.ingestionSource === 'mixed' ||
		current.ingestionSource !== previous.ingestionSource
	) {
		growthSuppressedReason = 'incomparable-ingestion-sources';
	} else if (
		coverageRatio(current) < MIN_COMPARABLE_HOUR_COVERAGE ||
		coverageRatio(previous) < MIN_COMPARABLE_HOUR_COVERAGE
	) {
		growthSuppressedReason = 'insufficient-hour-coverage';
	}

	return {
		comparable: growthSuppressedReason === null,
		growthSuppressedReason,
		current,
		previous,
		comparisonLabel: null
	};
}

function metadataFromDatasetRun(run: BackfillDatasetRun): DetectionWindowMetadata {
	const sampled = run.sampledRepos;
	const enriched = run.enrichedRepos;
	return {
		windowStart: run.windowStart,
		windowEnd: run.windowEnd,
		ingestionSource: run.source === 'github-search' ? 'github-search' : 'unknown',
		totalObservedRepos: run.observedRepos,
		enrichedRepos: enriched,
		enrichedCoverage: sampled > 0 ? Math.round((enriched / sampled) * 1000) / 1000 : 0,
		hoursExpected: run.expectedShards,
		hoursProcessed: run.completedShards,
		deduplicationVersion: run.deduplicationVersion,
		datasetId: run.id,
		queryVersion: run.queryVersion,
		shardingVersion: run.shardingVersion,
		samplingVersion: run.samplingVersion,
		constructionVersion: run.constructionVersion,
		candidatePoolSize: run.candidatePoolSize,
		expectedShards: run.expectedShards,
		completedShards: run.completedShards,
		partialShards: run.partialShards,
		failedShards: run.failedShards,
		sampledRepos: run.sampledRepos,
		comparisonMode: run.comparisonMode,
		comparisonLabel:
			run.comparisonMode === 'matched-hours'
				? `Matched ${run.matchedHourOffsets.length}-hour comparison`
				: run.comparisonMode === 'full-window'
					? 'Full-window comparison'
					: 'Absolute-density dataset'
	};
}

export function getDetectionComparability(opts: {
	periodEnd?: Date;
	windowDays?: number;
	currentDatasetId?: number;
	previousDatasetId?: number;
} = {}): DetectionComparability {
	if (opts.currentDatasetId != null && opts.previousDatasetId != null) {
		const currentRun = refreshDatasetEnrichmentCounts(opts.currentDatasetId);
		const previousRun = refreshDatasetEnrichmentCounts(opts.previousDatasetId);
		const datasetCmp = evaluateDatasetComparability(currentRun, previousRun);
		return {
			comparable: datasetCmp.comparable,
			growthSuppressedReason: datasetCmp.growthSuppressedReason,
			current: metadataFromDatasetRun(currentRun),
			previous: metadataFromDatasetRun(previousRun),
			comparisonLabel:
				currentRun.comparisonMode === 'matched-hours'
					? `Matched ${datasetCmp.matchedHourCount}-hour comparison`
					: currentRun.comparisonMode === 'full-window'
						? 'Full-window comparison'
						: 'Absolute-density dataset'
		};
	}

	const windowDays = opts.windowDays ?? 7;
	const periodEnd = opts.periodEnd ?? new Date();
	const periodStart = new Date(periodEnd.getTime() - windowDays * 86_400_000);
	const previousStart = new Date(periodStart.getTime() - windowDays * 86_400_000);
	return evaluateWindowComparability(
		getDetectionWindowMetadata(periodStart.toISOString(), periodEnd.toISOString()),
		getDetectionWindowMetadata(previousStart.toISOString(), periodStart.toISOString())
	);
}

export interface EmergingNearMiss {
	key: string;
	label: string;
	candidateType: EmergingCandidateType;
	currentCount: number;
	previousCount: number;
	distinctOwnerCount: number;
	highSignalCount: number;
	lowSignalCount: number;
	emergingScore: number | null;
	rejectedBecause: string;
	proximityScore: number;
}

export function listEmergingNearMisses(opts: {
	periodEnd?: Date;
	windowDays?: number;
	limit?: number;
	minCurrentCount?: number;
	currentDatasetId?: number;
	previousDatasetId?: number;
} = {}): EmergingNearMiss[] {
	const periodEnd = opts.periodEnd ?? new Date();
	const windowDays = opts.windowDays ?? 7;
	const limit = opts.limit ?? 25;
	const minCurrent = opts.minCurrentCount ?? 3;

	const { buckets, historicalEntries, comparability } = collectEmergingBuckets({
		periodEnd,
		windowDays,
		currentDatasetId: opts.currentDatasetId,
		previousDatasetId: opts.previousDatasetId
	});
	const misses: EmergingNearMiss[] = [];

	for (const bucket of buckets.values()) {
		const currentCount = bucket.currentRepoIds.size;
		if (currentCount < minCurrent) continue;
		const rejection = evaluateBucketRejection(
			bucket,
			historicalEntries.get(bucket.key) ?? null,
			comparability
		);
		if (!rejection) continue;
		misses.push({
			key: bucket.key,
			label: bucket.label,
			candidateType: bucket.candidateType,
			currentCount,
			previousCount: bucket.previousRepoIds.size,
			distinctOwnerCount: bucket.owners.size,
			highSignalCount: bucket.highSignalCount,
			lowSignalCount: bucket.lowSignalCount,
			emergingScore: rejection.emergingScore,
			rejectedBecause: rejection.reason,
			proximityScore: rejection.proximityScore
		});
	}

	return misses.sort((a, b) => b.proximityScore - a.proximityScore).slice(0, limit);
}

export function detectEmergingTopics(opts: {
	periodEnd?: Date;
	windowDays?: number;
	limit?: number;
	version?: number;
	currentDatasetId?: number;
	previousDatasetId?: number;
} = {}): EmergingCandidate[] {
	const limit = opts.limit ?? 100;
	const { buckets, historicalEntries, comparability } = collectEmergingBuckets(opts);

	return [...buckets.values()]
		.map((bucket) => scoreBucket(bucket, historicalEntries.get(bucket.key) ?? null, comparability))
		.filter((candidate): candidate is EmergingCandidate => candidate != null)
		.sort((a, b) => b.emergingScore - a.emergingScore)
		.slice(0, limit);
}

function collectEmergingBuckets(opts: {
	periodEnd?: Date;
	windowDays?: number;
	currentDatasetId?: number;
	previousDatasetId?: number;
}): {
	buckets: Map<string, CandidateBucket>;
	historicalEntries: Map<string, HistoryEntry>;
	comparability: DetectionComparability;
} {
	const windowDays = opts.windowDays ?? 7;
	const periodEnd = opts.periodEnd ?? new Date();
	const periodStart = new Date(periodEnd.getTime() - windowDays * 86_400_000);
	const previousStart = new Date(periodStart.getTime() - windowDays * 86_400_000);

	let comparability: DetectionComparability;
	let currentRows: RepoRow[];
	let previousRows: RepoRow[];

	if (opts.currentDatasetId != null && opts.previousDatasetId != null) {
		const currentRun = getDatasetRun(opts.currentDatasetId);
		const previousRun = getDatasetRun(opts.previousDatasetId);
		if (!currentRun || !previousRun) {
			throw new Error('Both EMERGING_CURRENT_DATASET_ID and EMERGING_PREVIOUS_DATASET_ID must exist');
		}
		comparability = getDetectionComparability({
			currentDatasetId: opts.currentDatasetId,
			previousDatasetId: opts.previousDatasetId
		});
		currentRows = listReposInDataset(opts.currentDatasetId);
		previousRows = listReposInDataset(opts.previousDatasetId);
	} else {
		comparability = evaluateWindowComparability(
			getDetectionWindowMetadata(periodStart.toISOString(), periodEnd.toISOString()),
			getDetectionWindowMetadata(previousStart.toISOString(), periodStart.toISOString())
		);
		currentRows = listReposCreatedBetween(periodStart.toISOString(), periodEnd.toISOString());
		previousRows = listReposCreatedBetween(previousStart.toISOString(), periodStart.toISOString());
	}

	const rules = loadEmergingDetectionRules();
	const historicalEntries = collectHistoricalCandidateEntries(
		previousStart.toISOString(),
		windowDays,
		rules
	);
	const buckets = new Map<string, CandidateBucket>();

	for (const row of previousRows) {
		for (const candidate of extractCandidates(row, rules)) {
			const bucket = getBucket(buckets, candidate);
			bucket.previousRepoIds.add(row.id);
			if (!bucket.earliestCurrentCreatedAt || row.created_at < bucket.earliestCurrentCreatedAt) {
				bucket.earliestCurrentCreatedAt = row.created_at;
			}
		}
	}

	for (const row of currentRows) {
		for (const candidate of extractCandidates(row, rules)) {
			const bucket = getBucket(buckets, candidate);
			const firstHit = !bucket.currentRepoIds.has(row.id);
			bucket.currentRepoIds.add(row.id);
			bucket.sources.set(candidate.candidateType, (bucket.sources.get(candidate.candidateType) ?? 0) + 1);
			if (candidate.aliasedFrom) {
				bucket.aliasHits.set(candidate.aliasedFrom, (bucket.aliasHits.get(candidate.aliasedFrom) ?? 0) + 1);
			}
			if (!firstHit) continue;
			bucket.owners.set(row.owner, (bucket.owners.get(row.owner) ?? 0) + 1);
			const category = row.category ?? 'unknown';
			bucket.categories.set(category, (bucket.categories.get(category) ?? 0) + 1);
			if (row.language) bucket.languages.set(row.language, (bucket.languages.get(row.language) ?? 0) + 1);
			if (row.interesting_score != null) {
				bucket.scoreSum += row.interesting_score;
				bucket.scoredCount += 1;
			}
			if (row.signal_tier === 'low') bucket.lowSignalCount += 1;
			else bucket.highSignalCount += 1;
			bucket.nameCounts.set(row.name.toLowerCase(), (bucket.nameCounts.get(row.name.toLowerCase()) ?? 0) + 1);
			if (!bucket.earliestCurrentCreatedAt || row.created_at < bucket.earliestCurrentCreatedAt) {
				bucket.earliestCurrentCreatedAt = row.created_at;
			}
			if (bucket.exampleRepos.length < 8) {
				bucket.exampleRepos.push({
					id: row.id,
					fullName: row.full_name,
					owner: row.owner,
					interestingScore: row.interesting_score,
					signalTier: row.signal_tier
				});
			}
		}
	}

	return { buckets, historicalEntries, comparability };
}

function evaluateBucketRejection(
	bucket: CandidateBucket,
	historyEntry: HistoryEntry | null,
	comparability: DetectionComparability
): { reason: string; emergingScore: number | null; proximityScore: number } | null {
	const currentCount = bucket.currentRepoIds.size;
	const distinctOwnerCount = bucket.owners.size;
	const lowSignalRatio = currentCount > 0 ? bucket.lowSignalCount / currentCount : 0;
	const singleOwnerShare =
		currentCount > 0 && bucket.owners.size > 0 ? Math.max(...bucket.owners.values()) / currentCount : 0;
	const schoolAssignmentShare =
		currentCount > 0 ? (bucket.categories.get('school-assignment') ?? 0) / currentCount : 0;
	const duplicateName =
		currentCount > 0 && bucket.nameCounts.size > 0
			? Math.max(...bucket.nameCounts.values()) / currentCount
			: 0;

	const proximityScore = Math.round(
		Math.min(currentCount / MIN_CURRENT_COUNT, 1) * 40 +
			Math.min(distinctOwnerCount / MIN_DISTINCT_OWNERS, 1) * 30 +
			Math.min(bucket.highSignalCount / MIN_HIGH_SIGNAL_COUNT, 1) * 30
	);

	if (currentCount < MIN_CURRENT_COUNT) {
		return {
			reason: 'current count below threshold',
			emergingScore: null,
			proximityScore
		};
	}
	if (bucket.highSignalCount < MIN_HIGH_SIGNAL_COUNT) {
		return {
			reason: 'high-signal count below threshold',
			emergingScore: null,
			proximityScore
		};
	}
	if (distinctOwnerCount < MIN_DISTINCT_OWNERS) {
		return {
			reason: 'distinct owners below threshold',
			emergingScore: null,
			proximityScore
		};
	}
	if (lowSignalRatio > 0.6) {
		return { reason: 'low-signal ratio too high', emergingScore: null, proximityScore };
	}
	if (schoolAssignmentShare > 0.7) {
		return { reason: 'coursework flood', emergingScore: null, proximityScore };
	}
	if (singleOwnerShare > 0.7) {
		return { reason: 'single-owner share too high', emergingScore: null, proximityScore };
	}

	const previousCount = bucket.previousRepoIds.size;
	const averageInterestingScore =
		bucket.scoredCount > 0 ? Math.round((bucket.scoreSum / bucket.scoredCount) * 10) / 10 : 0;
	const historicalCount = historyEntry?.total ?? 0;
	const currentPrevalence =
		comparability.current.enrichedRepos > 0
			? currentCount / comparability.current.enrichedRepos
			: 0;
	const previousPrevalence =
		comparability.previous.enrichedRepos > 0
			? previousCount / comparability.previous.enrichedRepos
			: 0;
	const scores = computeBucketScores({
		currentCount,
		previousCount,
		currentPrevalence,
		previousPrevalence,
		usePrevalenceMomentum: comparability.current.comparisonMode === 'matched-hours',
		distinctOwnerCount,
		highSignalCount: bucket.highSignalCount,
		categoryCount: bucket.categories.size,
		averageInterestingScore,
		historicalCount,
		duplicateName,
		lowSignalRatio,
		singleOwnerShare,
		schoolAssignmentShare,
		suppressGrowth: !comparability.comparable
	});

	if (scores.emergingScore < 35) {
		return { reason: 'emerging score below threshold', emergingScore: scores.emergingScore, proximityScore };
	}

	return null;
}

type BucketScoreInput = {
	currentCount: number;
	previousCount: number;
	currentPrevalence?: number;
	previousPrevalence?: number;
	usePrevalenceMomentum?: boolean;
	distinctOwnerCount: number;
	highSignalCount: number;
	categoryCount: number;
	averageInterestingScore: number;
	historicalCount: number;
	duplicateName: number;
	lowSignalRatio: number;
	singleOwnerShare: number;
	schoolAssignmentShare: number;
	suppressGrowth: boolean;
};

function computeBucketScores(input: BucketScoreInput): {
	momentumScore: number | null;
	noveltyScore: number;
	qualityScore: number;
	ownerDiversityScore: number;
	categoryDiversityScore: number;
	penalty: number;
	emergingScore: number;
} {
	const momentumScore = input.suppressGrowth
		? null
		: input.usePrevalenceMomentum && input.previousPrevalence != null && input.currentPrevalence != null
			? input.previousPrevalence === 0
				? Math.min(100, 50 + input.currentCount * 2)
				: Math.min(
						100,
						Math.max(
							0,
							((input.currentPrevalence - input.previousPrevalence) /
								input.previousPrevalence) *
								60 +
								input.currentCount
						)
					)
			: input.previousCount === 0
			? Math.min(100, 50 + input.currentCount * 2)
			: Math.min(
					100,
					Math.max(
						0,
						((input.currentCount - input.previousCount) / input.previousCount) * 60 + input.currentCount
					)
				);
	const noveltyScore = Math.max(0, Math.min(100, 100 - input.historicalCount * 1.5));
	const highSignalRatio = input.currentCount > 0 ? input.highSignalCount / input.currentCount : 0;
	const qualityScore = Math.min(100, input.averageInterestingScore * 0.8 + highSignalRatio * 20);
	const ownerDiversityScore =
		input.currentCount > 0 ? Math.min(100, (input.distinctOwnerCount / input.currentCount) * 100) : 0;
	const categoryDiversityScore = Math.min(100, input.categoryCount * 22);
	let penalty = 0;
	if (input.duplicateName > 0.5) penalty += 20;
	if (input.lowSignalRatio > 0.4) penalty += 15;
	if (input.singleOwnerShare > 0.4) penalty += 20;
	if (input.schoolAssignmentShare > 0.4) penalty += 20;

	// With growth suppressed the momentum weight (0.35) is redistributed
	// proportionally so absolute detection keeps the same 0-100 scale.
	const emergingScore =
		momentumScore === null
			? Math.max(
					0,
					Math.round(
						noveltyScore * (0.25 / 0.65) +
							qualityScore * (0.2 / 0.65) +
							ownerDiversityScore * (0.1 / 0.65) +
							categoryDiversityScore * (0.1 / 0.65) -
							penalty
					)
				)
			: Math.max(
					0,
					Math.round(
						momentumScore * 0.35 +
							noveltyScore * 0.25 +
							qualityScore * 0.2 +
							ownerDiversityScore * 0.1 +
							categoryDiversityScore * 0.1 -
							penalty
					)
				);

	return {
		momentumScore,
		noveltyScore,
		qualityScore,
		ownerDiversityScore,
		categoryDiversityScore,
		penalty,
		emergingScore
	};
}

export function persistEmergingTopics(candidates: EmergingCandidate[], opts: {
	periodStart: string;
	periodEnd: string;
	version?: number;
}): number {
	const db = getDb();
	const version = opts.version ?? CURRENT_EMERGING_DETECTION_VERSION;
	const generatedAt = new Date().toISOString();

	const tx = db.transaction(() => {
		let saved = 0;
		const insertTopic = db.prepare(
			`INSERT INTO emerging_topics (
			   key, label, candidate_type, status, period_start, period_end,
			   current_count, previous_count, distinct_owner_count, average_interesting_score,
			   novelty_score, momentum_score, quality_score, emerging_score,
			   evidence_json, history_json, detection_version, generated_at
			 )
			 VALUES (?, ?, ?, 'detected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(key, period_start, detection_version) DO UPDATE SET
			   label = excluded.label,
			   candidate_type = excluded.candidate_type,
			   period_end = excluded.period_end,
			   current_count = excluded.current_count,
			   previous_count = excluded.previous_count,
			   distinct_owner_count = excluded.distinct_owner_count,
			   average_interesting_score = excluded.average_interesting_score,
			   novelty_score = excluded.novelty_score,
			   momentum_score = excluded.momentum_score,
			   quality_score = excluded.quality_score,
			   emerging_score = excluded.emerging_score,
			   evidence_json = excluded.evidence_json,
			   history_json = excluded.history_json,
			   generated_at = excluded.generated_at`
		);
		const getTopic = db.prepare(
			`SELECT id FROM emerging_topics WHERE key = ? AND period_start = ? AND detection_version = ?`
		);
		const deleteRepos = db.prepare('DELETE FROM emerging_topic_repositories WHERE emerging_topic_id = ?');
		const insertRepo = db.prepare(
			`INSERT OR REPLACE INTO emerging_topic_repositories
			 (emerging_topic_id, repository_id, relevance, evidence_json)
			 VALUES (?, ?, ?, ?)`
		);

		for (const candidate of candidates) {
			insertTopic.run(
				candidate.key,
				candidate.label,
				candidate.candidateType,
				opts.periodStart,
				opts.periodEnd,
				candidate.currentCount,
				candidate.previousCount,
				candidate.distinctOwnerCount,
				candidate.averageInterestingScore,
				candidate.noveltyScore,
				candidate.momentumScore ?? 0,
				candidate.qualityScore,
				candidate.emergingScore,
				JSON.stringify(candidate.evidence),
				JSON.stringify(candidate.history),
				version,
				generatedAt
			);
			const topic = getTopic.get(candidate.key, opts.periodStart, version) as { id: number };
			deleteRepos.run(topic.id);
			for (const repoId of candidate.repoIds.slice(0, 100)) {
				insertRepo.run(
					topic.id,
					repoId,
					candidate.emergingScore,
					JSON.stringify({ key: candidate.key, type: candidate.candidateType })
				);
			}
			saved += 1;
		}
		return saved;
	});

	return tx() as number;
}

export function runEmergingTopicDetection(opts: {
	periodEnd?: Date;
	windowDays?: number;
	limit?: number;
	version?: number;
	currentDatasetId?: number;
	previousDatasetId?: number;
} = {}): {
	saved: number;
	candidates: EmergingCandidate[];
	periodStart: string;
	periodEnd: string;
	comparability: DetectionComparability;
} {
	const windowDays = opts.windowDays ?? 7;
	let periodEndDate = opts.periodEnd ?? new Date();
	let periodStartDate = new Date(periodEndDate.getTime() - windowDays * 86_400_000);

	if (opts.currentDatasetId != null) {
		const currentRun = getDatasetRun(opts.currentDatasetId);
		if (currentRun) {
			periodStartDate = new Date(currentRun.windowStart);
			periodEndDate = new Date(currentRun.windowEnd);
		}
	}

	const comparability = getDetectionComparability({
		periodEnd: periodEndDate,
		windowDays,
		currentDatasetId: opts.currentDatasetId,
		previousDatasetId: opts.previousDatasetId
	});
	const candidates = detectEmergingTopics({
		...opts,
		periodEnd: periodEndDate,
		windowDays
	});
	const saved = persistEmergingTopics(candidates, {
		periodStart: periodStartDate.toISOString(),
		periodEnd: periodEndDate.toISOString(),
		version: opts.version
	});

	getDb()
		.prepare(
			`INSERT INTO emerging_detection_runs (
			   period_start, period_end, detection_version, candidates_detected,
			   growth_suppressed_reason, current_window_json, previous_window_json,
			   current_dataset_id, previous_dataset_id, generated_at
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			periodStartDate.toISOString(),
			periodEndDate.toISOString(),
			opts.version ?? CURRENT_EMERGING_DETECTION_VERSION,
			candidates.length,
			comparability.growthSuppressedReason,
			JSON.stringify(comparability.current),
			JSON.stringify(comparability.previous),
			opts.currentDatasetId ?? null,
			opts.previousDatasetId ?? null,
			new Date().toISOString()
		);

	return {
		saved,
		candidates,
		periodStart: periodStartDate.toISOString(),
		periodEnd: periodEndDate.toISOString(),
		comparability
	};
}

export function listEmergingTopics(opts: {
	limit?: number;
	status?: EmergingTopicStatus;
	version?: number;
} = {}): EmergingTopicRow[] {
	const db = getDb();
	const params: (string | number)[] = [opts.version ?? CURRENT_EMERGING_DETECTION_VERSION];
	const where = ['detection_version = ?'];
	if (opts.status) {
		where.push('status = ?');
		params.push(opts.status);
	} else {
		where.push(`status NOT IN ('dismissed', 'expired')`);
	}
	params.push(opts.limit ?? 50);
	return db
		.prepare(
			`SELECT * FROM emerging_topics
			 WHERE ${where.join(' AND ')}
			 ORDER BY period_start DESC, emerging_score DESC
			 LIMIT ?`
		)
		.all(...params) as EmergingTopicRow[];
}

export function getLatestEmergingDetectionProvenance(): {
	comparisonLabel: string | null;
	comparisonMode: DetectionWindowMetadata['comparisonMode'];
	growthSuppressedReason: string | null;
	current: DetectionWindowMetadata;
	previous: DetectionWindowMetadata;
} | null {
	const row = getDb()
		.prepare(
			`SELECT current_window_json, previous_window_json, growth_suppressed_reason
			 FROM emerging_detection_runs
			 ORDER BY id DESC LIMIT 1`
		)
		.get() as
		| {
				current_window_json: string;
				previous_window_json: string;
				growth_suppressed_reason: string | null;
		  }
		| undefined;
	if (!row) return null;
	try {
		const current = JSON.parse(row.current_window_json) as DetectionWindowMetadata;
		const previous = JSON.parse(row.previous_window_json) as DetectionWindowMetadata;
		return {
			comparisonLabel: current.comparisonLabel ?? null,
			comparisonMode: current.comparisonMode ?? null,
			growthSuppressedReason: row.growth_suppressed_reason,
			current,
			previous
		};
	} catch {
		return null;
	}
}

export function getEmergingTopicDetail(key: string): EmergingTopicDetail | null {
	const db = getDb();
	const topic = db
		.prepare(
			`SELECT * FROM emerging_topics
			 WHERE key = ?
			 ORDER BY period_start DESC, detection_version DESC
			 LIMIT 1`
		)
		.get(key) as EmergingTopicRow | undefined;
	if (!topic) return null;

	const repositories = db
		.prepare(
			`SELECT r.*,
			        er.relevance,
			        er.evidence_json AS match_evidence_json,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'readme') AS has_readme,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'source') AS has_source,
			        EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id) AS has_any_archive
			 FROM emerging_topic_repositories er
			 JOIN repos r ON r.id = er.repository_id
			 WHERE er.emerging_topic_id = ?
			 ORDER BY er.relevance DESC, r.interesting_score DESC`
		)
		.all(topic.id) as EmergingTopicRepositoryRow[];

	return {
		topic,
		evidence: JSON.parse(topic.evidence_json) as EmergingCandidateEvidence,
		history: topic.history_json ? (JSON.parse(topic.history_json) as EmergingCandidateHistory) : null,
		repositories
	};
}

export function updateEmergingTopicStatus(
	key: string,
	status: EmergingTopicStatus,
	reason?: EmergingReviewReason
): boolean {
	const db = getDb();
	const result = reason
		? db
				.prepare('UPDATE emerging_topics SET status = ?, review_reason = ?, reviewed_at = ? WHERE key = ?')
				.run(status, reason, new Date().toISOString(), key)
		: db.prepare('UPDATE emerging_topics SET status = ? WHERE key = ?').run(status, key);
	return result.changes > 0;
}

export function addEmergingTermAlias(alias: string, canonicalKey: string): void {
	const db = getDb();
	const normalizedAlias = normalizeKey(alias);
	const normalizedCanonical = normalizeKey(canonicalKey);
	if (!normalizedAlias || !normalizedCanonical || normalizedAlias === normalizedCanonical) {
		throw new Error('Alias and canonical key must be distinct non-empty terms');
	}
	db.prepare(
		`INSERT INTO emerging_term_aliases (alias, canonical_key, created_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(alias) DO UPDATE SET canonical_key = excluded.canonical_key`
	).run(normalizedAlias, normalizedCanonical, new Date().toISOString());
}

export function addEmergingTermExclusion(term: string, reason: string): void {
	const db = getDb();
	const normalized = normalizeKey(term);
	if (!normalized) throw new Error('Exclusion term must be non-empty');
	db.prepare(
		`INSERT INTO emerging_term_exclusions (term, reason, created_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(term) DO UPDATE SET reason = excluded.reason`
	).run(normalized, reason, new Date().toISOString());
}

export function listEmergingTermAliases(): Array<{ alias: string; canonical_key: string; created_at: string }> {
	return getDb()
		.prepare('SELECT alias, canonical_key, created_at FROM emerging_term_aliases ORDER BY canonical_key, alias')
		.all() as Array<{ alias: string; canonical_key: string; created_at: string }>;
}

export function listEmergingTermExclusions(): Array<{ term: string; reason: string; created_at: string }> {
	return getDb()
		.prepare('SELECT term, reason, created_at FROM emerging_term_exclusions ORDER BY term')
		.all() as Array<{ term: string; reason: string; created_at: string }>;
}

/**
 * Merge one detected topic into another: records a permanent alias so future
 * detection runs bucket the terms together, and dismisses the duplicate row.
 */
export function mergeEmergingTopic(key: string, canonicalKey: string): boolean {
	addEmergingTermAlias(key, canonicalKey);
	return updateEmergingTopicStatus(key, 'dismissed', 'alias-duplicate');
}

/**
 * Exclude a detected topic's term from all future detection runs and dismiss it.
 */
export function excludeEmergingTopic(key: string, reason: EmergingReviewReason): boolean {
	addEmergingTermExclusion(key, reason);
	return updateEmergingTopicStatus(key, 'dismissed', reason);
}

function scoreBucket(
	bucket: CandidateBucket,
	historyEntry: HistoryEntry | null,
	comparability: DetectionComparability
): EmergingCandidate | null {
	const currentCount = bucket.currentRepoIds.size;
	const previousCount = bucket.previousRepoIds.size;
	const distinctOwnerCount = bucket.owners.size;
	if (currentCount < MIN_CURRENT_COUNT) return null;
	if (bucket.highSignalCount < MIN_HIGH_SIGNAL_COUNT) return null;
	if (distinctOwnerCount < MIN_DISTINCT_OWNERS) return null;

	const suppressGrowth = !comparability.comparable;
	const historicalCount = historyEntry?.total ?? 0;
	const history = buildCandidateHistory(bucket, historyEntry, currentCount, previousCount);

	const averageInterestingScore =
		bucket.scoredCount > 0 ? Math.round((bucket.scoreSum / bucket.scoredCount) * 10) / 10 : 0;
	const currentPrevalence =
		comparability.current.enrichedRepos > 0
			? currentCount / comparability.current.enrichedRepos
			: 0;
	const previousPrevalence =
		comparability.previous.enrichedRepos > 0
			? previousCount / comparability.previous.enrichedRepos
			: 0;
	const prevalenceLiftPercent =
		!suppressGrowth && previousPrevalence > 0
			? Math.round(
					((currentPrevalence - previousPrevalence) / previousPrevalence) * 1000
				) / 10
			: null;
	const growthPercent =
		!suppressGrowth && previousCount >= 5
			? Math.round(((currentCount - previousCount) / previousCount) * 1000) / 10
			: null;

	const lowSignalRatio = bucket.lowSignalCount / currentCount;
	const singleOwnerShare = Math.max(...bucket.owners.values()) / currentCount;
	const schoolAssignmentShare = (bucket.categories.get('school-assignment') ?? 0) / currentCount;
	const duplicateName = Math.max(...bucket.nameCounts.values()) / currentCount;
	if (lowSignalRatio > 0.6) return null;
	if (schoolAssignmentShare > 0.7) return null;
	if (singleOwnerShare > 0.7) return null;

	const {
		momentumScore,
		noveltyScore,
		qualityScore,
		ownerDiversityScore,
		categoryDiversityScore,
		penalty,
		emergingScore
	} = computeBucketScores({
		currentCount,
		previousCount,
		currentPrevalence,
		previousPrevalence,
		usePrevalenceMomentum: comparability.current.comparisonMode === 'matched-hours',
		distinctOwnerCount,
		highSignalCount: bucket.highSignalCount,
		categoryCount: bucket.categories.size,
		averageInterestingScore,
		historicalCount,
		duplicateName,
		lowSignalRatio,
		singleOwnerShare,
		schoolAssignmentShare,
		suppressGrowth
	});

	if (emergingScore < 35) return null;

	const evidence: EmergingCandidateEvidence = {
		currentRepoIds: [...bucket.currentRepoIds],
		previousRepoIds: [...bucket.previousRepoIds],
		exampleRepos: bucket.exampleRepos,
		categories: Object.fromEntries(bucket.categories),
		languages: Object.fromEntries(bucket.languages),
		scoreBreakdown: {
			momentum: momentumScore === null ? null : Math.round(momentumScore),
			novelty: Math.round(noveltyScore),
			quality: Math.round(qualityScore),
			ownerDiversity: Math.round(ownerDiversityScore),
			categoryDiversity: Math.round(categoryDiversityScore),
			penalties: penalty
		},
		growthSuppressedReason: comparability.growthSuppressedReason,
		prevalence: {
			current: Math.round(currentPrevalence * 100_000) / 100_000,
			previous: Math.round(previousPrevalence * 100_000) / 100_000,
			liftPercent: prevalenceLiftPercent
		},
		ratios: {
			lowSignal: Math.round(lowSignalRatio * 1000) / 1000,
			singleOwnerShare: Math.round(singleOwnerShare * 1000) / 1000,
			schoolAssignmentShare: Math.round(schoolAssignmentShare * 1000) / 1000,
			duplicateName: Math.round(duplicateName * 1000) / 1000
		},
		sources: Object.fromEntries(bucket.sources),
		aliasHits: Object.fromEntries(bucket.aliasHits)
	};

	return {
		key: bucket.key,
		label: bucket.label,
		candidateType: bucket.candidateType,
		currentCount,
		previousCount,
		growthPercent,
		currentPrevalence: Math.round(currentPrevalence * 100_000) / 100_000,
		previousPrevalence: Math.round(previousPrevalence * 100_000) / 100_000,
		prevalenceLiftPercent,
		repoIds: [...bucket.currentRepoIds],
		categories: Object.fromEntries(bucket.categories),
		languages: Object.fromEntries(bucket.languages),
		averageInterestingScore,
		highSignalCount: bucket.highSignalCount,
		lowSignalCount: bucket.lowSignalCount,
		distinctOwnerCount,
		noveltyScore: Math.round(noveltyScore),
		momentumScore: momentumScore === null ? null : Math.round(momentumScore),
		qualityScore: Math.round(qualityScore),
		ownerDiversityScore: Math.round(ownerDiversityScore),
		categoryDiversityScore: Math.round(categoryDiversityScore),
		emergingScore,
		growthSuppressedReason: comparability.growthSuppressedReason,
		history,
		evidence
	};
}

function buildCandidateHistory(
	bucket: CandidateBucket,
	entry: HistoryEntry | null,
	currentCount: number,
	previousCount: number
): EmergingCandidateHistory {
	// Window counts are ordered most-recent-first for the windows before the
	// previous period: [-2w..-1w), [-3w..-2w), [-4w..-3w), [-5w..-4w).
	const priorWindows = entry?.windowCounts ?? [0, 0, 0, 0];
	const fourWeek = [previousCount, priorWindows[0], priorWindows[1], priorWindows[2]];
	const fourWeekAverage = Math.round((fourWeek.reduce((a, b) => a + b, 0) / 4) * 10) / 10;

	// Consecutive growth streak ending with the current period.
	const sequence = [priorWindows[2], priorWindows[1], priorWindows[0], previousCount, currentCount];
	let consecutiveGrowthPeriods = 0;
	for (let i = sequence.length - 1; i > 0; i--) {
		if (sequence[i] > sequence[i - 1]) consecutiveGrowthPeriods += 1;
		else break;
	}

	const firstSeenAt = entry?.firstSeenAt ?? bucket.earliestCurrentCreatedAt ?? new Date().toISOString();
	return {
		currentCount,
		previousCount,
		fourWeekAverage,
		allTimeCount: (entry?.total ?? 0) + previousCount + currentCount,
		firstSeenAt,
		consecutiveGrowthPeriods
	};
}

function getBucket(buckets: Map<string, CandidateBucket>, candidate: ExtractedCandidate): CandidateBucket {
	const existing = buckets.get(candidate.key);
	if (existing) return existing;
	const bucket: CandidateBucket = {
		key: candidate.key,
		label: candidate.label,
		candidateType: candidate.candidateType,
		currentRepoIds: new Set(),
		previousRepoIds: new Set(),
		owners: new Map(),
		categories: new Map(),
		languages: new Map(),
		scoreSum: 0,
		scoredCount: 0,
		highSignalCount: 0,
		lowSignalCount: 0,
		nameCounts: new Map(),
		sources: new Map(),
		aliasHits: new Map(),
		earliestCurrentCreatedAt: null,
		exampleRepos: []
	};
	buckets.set(candidate.key, bucket);
	return bucket;
}

function extractCandidates(row: RepoRow, rules?: EmergingDetectionRules): ExtractedCandidate[] {
	const candidates: ExtractedCandidate[] = [];

	const push = (rawKey: string, candidateType: EmergingCandidateType) => {
		const canonical = rules?.aliases.get(rawKey);
		const key = canonical ?? rawKey;
		if (rules?.exclusions.has(key) || (canonical && rules?.exclusions.has(rawKey))) return;
		if (!isAllowedCandidate(key, candidateType)) return;
		candidates.push({
			key,
			label: labelize(key),
			candidateType,
			aliasedFrom: canonical ? rawKey : undefined
		});
	};

	for (const topic of parseTopics(row.topics)) {
		push(normalizeKey(topic), 'topic');
	}

	for (const key of extractNameCandidates(row.name)) {
		push(key, 'name-token');
	}

	for (const key of extractDescriptionPhrases(row.description ?? '')) {
		push(key, 'phrase');
	}

	return uniqueCandidates(candidates);
}

function extractNameCandidates(name: string): string[] {
	const normalized = normalizeKey(name);
	const parts = normalized.split('-').filter(Boolean);
	const out = new Set<string>();
	if (parts.length >= 2 && !isAllowedCandidate(normalized, 'name-token')) {
		// Keep scanning parts even when the full name is too generic.
	} else if (parts.length >= 2) {
		out.add(normalized);
	}
	for (const part of parts) out.add(part);
	for (let i = 0; i < parts.length - 1; i++) out.add(`${parts[i]}-${parts[i + 1]}`);
	if (/^[a-z]{4,24}$/.test(name) && !STOPWORDS.has(name.toLowerCase())) out.add(name.toLowerCase());
	return [...out];
}

function extractDescriptionPhrases(description: string): string[] {
	const words = normalizeKey(description).split('-').filter((word) => word.length >= 3 && !STOPWORDS.has(word));
	const out = new Set<string>();
	for (let i = 0; i < words.length - 1; i++) out.add(`${words[i]}-${words[i + 1]}`);
	for (let i = 0; i < words.length - 2; i++) out.add(`${words[i]}-${words[i + 1]}-${words[i + 2]}`);
	return [...out].slice(0, 12);
}

function uniqueCandidates(candidates: ExtractedCandidate[]): ExtractedCandidate[] {
	const seen = new Set<string>();
	const out: ExtractedCandidate[] = [];
	for (const candidate of candidates) {
		const id = `${candidate.candidateType}:${candidate.key}`;
		if (seen.has(id)) continue;
		seen.add(id);
		out.push(candidate);
	}
	return out;
}

export function normalizeKey(value: string): string {
	const lower = value.toLowerCase().replace(/model[-_\s]*context[-_\s]*protocol/g, 'mcp');
	return lower
		.replace(/([a-z])([A-Z])/g, '$1-$2')
		.replace(/[_\s./]+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/mcpserver/g, 'mcp-server')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function isAllowedCandidate(key: string, candidateType: EmergingCandidateType): boolean {
	if (key.length < 3 || key.length > 48) return false;
	if (/^\d+$/.test(key)) return false;
	if (/^(lab|hw|assignment|project)-?\d+$/i.test(key)) return false;
	const parts = key.split('-');
	if (parts.every((part) => STOPWORDS.has(part))) return false;
	if (parts.length === 1 && STOPWORDS.has(key)) return false;
	if (parts.length === 1 && COMMON_TECH.has(key)) return false;
	if (CURATED_TERMS.has(key)) return false;
	return true;
}

function labelize(key: string): string {
	return key
		.split('-')
		.map((part) => (part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
		.join(' ');
}

function listReposCreatedBetween(start: string, end: string): RepoRow[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT * FROM repos
			 WHERE created_at >= ? AND created_at < ?
			   AND enriched_at IS NOT NULL`
		)
		.all(start, end) as RepoRow[];
}

function listReposInDataset(runId: number): RepoRow[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT r.*
			 FROM backfill_dataset_repositories d
			 JOIN repos r ON r.id = d.repository_id
			 WHERE d.run_id = ?
			   AND r.enriched_at IS NOT NULL`
		)
		.all(runId) as RepoRow[];
}

function collectHistoricalCandidateEntries(
	before: string,
	windowDays: number,
	rules: EmergingDetectionRules
): Map<string, HistoryEntry> {
	const db = getDb();
	const beforeMs = Date.parse(before);
	const rows = db
		.prepare(
			`SELECT name, description, topics, created_at FROM repos
			 WHERE created_at < ? AND enriched_at IS NOT NULL
			 ORDER BY created_at DESC
			 LIMIT 50000`
		)
		.all(before) as Pick<RepoRow, 'name' | 'description' | 'topics' | 'created_at'>[];
	const entries = new Map<string, HistoryEntry>();
	for (const row of rows) {
		const ageMs = beforeMs - Date.parse(row.created_at);
		const windowIndex = Math.floor(ageMs / (windowDays * 86_400_000));
		const fake = {
			...row,
			id: 0,
			owner: '',
			full_name: '',
			github_url: '',
			event_id: '',
			created_at: row.created_at,
			first_seen_at: '',
			default_branch: null,
			language: null,
			stars: null,
			forks: null,
			watchers: null,
			license: null,
			pushed_at: null,
			updated_at: null,
			enriched_at: '',
			deleted_at: null,
			github_archived: 0,
			last_checked_at: null,
			open_issues: null,
			size: null,
			discovery_source: 'gharchive',
			homepage: null,
			visibility: null,
			owner_avatar_url: null,
			owner_type: null,
			summary: null,
			summary_generated_at: null,
			category: null,
			category_confidence: null,
			classified_at: null,
			interesting_score: null,
			signal_tier: null,
			scored_at: null,
			cluster_version: null,
			clustered_at: null,
			story_facts_json: null,
			story_text: null,
			story_version: null,
			story_generated_at: null,
			enrichment_level: 1
		} satisfies RepoRow;
		for (const candidate of extractCandidates(fake, rules)) {
			let entry = entries.get(candidate.key);
			if (!entry) {
				entry = { total: 0, firstSeenAt: null, windowCounts: [0, 0, 0, 0] };
				entries.set(candidate.key, entry);
			}
			entry.total += 1;
			if (!entry.firstSeenAt || row.created_at < entry.firstSeenAt) {
				entry.firstSeenAt = row.created_at;
			}
			if (windowIndex >= 0 && windowIndex < HISTORY_WINDOWS) {
				entry.windowCounts[windowIndex] += 1;
			}
		}
	}
	return entries;
}
