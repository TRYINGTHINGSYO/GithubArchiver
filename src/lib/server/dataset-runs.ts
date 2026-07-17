import { listHourKeysBetween } from '$lib/server/gharchive';
import {
	clearDatasetMembership,
	countDatasetEnriched,
	countDatasetMembership,
	createDatasetRun,
	getDatasetRun,
	insertDatasetMembership,
	listDatasetRuns,
	stableSampleRank,
	updateDatasetRun,
	upsertDatasetShard,
	type BackfillDatasetRun,
	DATASET_DEDUPLICATION_VERSION,
	DATASET_QUERY_VERSION,
	DATASET_SAMPLING_VERSION,
	DATASET_SHARDING_VERSION,
	DATASET_CONSTRUCTION_VERSION,
	DEFAULT_CANDIDATE_POOL_SIZE
} from '$lib/server/db/dataset-runs';
import { getDb } from '$lib/server/db/connection';
import { buildMatchedPairSampleFirst } from '$lib/server/matched-sample-first';

export type {
	BackfillDatasetRun,
	DatasetRunSource,
	DatasetRunStatus,
	DatasetComparisonMode
} from '$lib/server/db/dataset-runs';

export {
	createDatasetRun,
	getDatasetRun,
	getDatasetEnrichmentProgress,
	listDatasetRuns,
	listUnenrichedDatasetRepos,
	stableSampleRank,
	DATASET_QUERY_VERSION,
	DATASET_SHARDING_VERSION,
	DATASET_DEDUPLICATION_VERSION,
	DATASET_SAMPLING_VERSION,
	DATASET_CONSTRUCTION_VERSION,
	DEFAULT_CANDIDATE_POOL_SIZE
} from '$lib/server/db/dataset-runs';
export type { DatasetEnrichmentProgress } from '$lib/server/db/dataset-runs';
export {
	buildMatchedPairSampleFirst,
	collectHourCandidatePool,
	selectSampleFromPool,
	matchedMinuteShardOrder
} from '$lib/server/matched-sample-first';

export type TemporalCoverage = {
	uniqueHoursRepresented: number;
	representedHourRatio: number;
	largestHourShare: number;
	hourlyDistributionEntropy: number;
	hourOffsets: number[];
};

export type DatasetComparability = {
	comparable: boolean;
	growthSuppressedReason: string | null;
	current: BackfillDatasetRun;
	previous: BackfillDatasetRun;
	effectiveSampleRatio: number | null;
	enrichmentCoverageDifference: number | null;
	currentTemporal: TemporalCoverage;
	previousTemporal: TemporalCoverage;
	matchedHourCount: number;
	matchedHourRatio: number;
	completedMatchedHourRatio: number;
	partialMatchedHours: number;
	maxPerHourSampleDifference: number;
	temporalComparable: boolean;
};

const MIN_UNIQUE_HOURS = 24;
const MAX_LARGEST_HOUR_SHARE = 0.1;
const MIN_MATCHED_HOUR_RATIO = 0.8;

type CandidateRow = {
	id: number;
	full_name: string;
	created_at: string;
	enriched_at: string | null;
};

export type MatchedDatasetPair = {
	previous: BackfillDatasetRun;
	current: BackfillDatasetRun;
	requestedHourOffsets: number[];
	includedHourOffsets: number[];
	excludedHourOffsets: number[];
};

function hourKeyFromIso(iso: string): string {
	return `${iso.slice(0, 10)}-${iso.slice(11, 13)}`;
}

function hourKeysForWindow(windowStart: string, windowEnd: string): string[] {
	const startKey = hourKeyFromIso(windowStart);
	const endExclusive = hourKeyFromIso(windowEnd);
	const inclusiveEndMs = Date.parse(windowEnd) - 3_600_000;
	if (inclusiveEndMs < Date.parse(windowStart)) return [];
	const endInclusive = hourKeyFromIso(new Date(inclusiveEndMs).toISOString());
	return listHourKeysBetween(startKey, endInclusive).filter((key) => key < endExclusive);
}

function hourKeyAtOffset(windowStart: string, offset: number): string {
	return hourKeyFromIso(new Date(Date.parse(windowStart) + offset * 3_600_000).toISOString());
}

function parseHourKeyUtc(hourKey: string): Date {
	return new Date(`${hourKey.slice(0, 10)}T${hourKey.slice(11, 13)}:00:00Z`);
}

function candidatesForHour(hourKey: string, allowedFullNames?: Set<string>): CandidateRow[] {
	const start = parseHourKeyUtc(hourKey);
	const end = new Date(start.getTime() + 3_600_000);
	const rows = getDb()
		.prepare(
			`SELECT id, full_name, created_at, enriched_at
			 FROM repos
			 WHERE created_at >= ? AND created_at < ?
			   AND discovery_source IN ('github_search', 'gharchive')
			 ORDER BY id ASC`
		)
		.all(start.toISOString(), end.toISOString()) as CandidateRow[];
	return allowedFullNames
		? rows.filter((row) => allowedFullNames.has(row.full_name.toLowerCase()))
		: rows;
}

function rankHour(run: BackfillDatasetRun, hourKey: string, rows: CandidateRow[]) {
	return rows
		.map((row) => ({
			row,
			rank: stableSampleRank(run.samplingVersion, hourKey, row.full_name)
		}))
		.sort((a, b) => a.rank - b.rank || a.row.id - b.row.id);
}

export function matchedHourOffsetsForWeek(hoursPerDay: number[]): number[] {
	const hours = [...new Set(hoursPerDay)]
		.filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
		.sort((a, b) => a - b);
	if (hours.length === 0) throw new Error('At least one valid UTC hour is required');
	return Array.from({ length: 7 }, (_, day) => hours.map((hour) => day * 24 + hour)).flat();
}

export function createMatchedDatasetPair(opts: {
	previousStart: string;
	currentStart: string;
	hoursPerDay?: number[];
	samplePerHour?: number;
	candidatePoolSize?: number;
}): MatchedDatasetPair {
	const requestedHourOffsets = matchedHourOffsetsForWeek(opts.hoursPerDay ?? [0, 6, 12, 18]);
	const samplePerHour = opts.samplePerHour ?? 25;
	const candidatePoolSize = opts.candidatePoolSize ?? DEFAULT_CANDIDATE_POOL_SIZE;
	if (!Number.isInteger(samplePerHour) || samplePerHour <= 0) {
		throw new Error('samplePerHour must be a positive integer');
	}
	if (!Number.isInteger(candidatePoolSize) || candidatePoolSize < samplePerHour) {
		throw new Error('candidatePoolSize must be an integer >= samplePerHour');
	}
	const weekMs = 7 * 86_400_000;
	const previousEnd = new Date(Date.parse(opts.previousStart) + weekMs).toISOString();
	const currentEnd = new Date(Date.parse(opts.currentStart) + weekMs).toISOString();
	const shared = {
		comparisonMode: 'matched-hours' as const,
		matchedHourOffsets: requestedHourOffsets,
		maxPerHour: samplePerHour,
		targetSampleSize: requestedHourOffsets.length * samplePerHour,
		candidatePoolSize,
		constructionVersion: DATASET_CONSTRUCTION_VERSION,
		queryVersion: DATASET_QUERY_VERSION,
		shardingVersion: DATASET_SHARDING_VERSION,
		deduplicationVersion: DATASET_DEDUPLICATION_VERSION,
		samplingVersion: DATASET_SAMPLING_VERSION
	};
	const previous = createDatasetRun({
		windowStart: opts.previousStart,
		windowEnd: previousEnd,
		...shared
	});
	const current = createDatasetRun({
		windowStart: opts.currentStart,
		windowEnd: currentEnd,
		...shared
	});
	updateDatasetRun(previous.id, { pairedRunId: current.id });
	updateDatasetRun(current.id, { pairedRunId: previous.id });
	return {
		previous: getDatasetRun(previous.id) ?? previous,
		current: getDatasetRun(current.id) ?? current,
		requestedHourOffsets,
		includedHourOffsets: [],
		excludedHourOffsets: []
	};
}

/**
 * Freeze symmetric memberships from the repository pool. Sparse hours are
 * excluded from both sides and no repository is ever borrowed from another hour.
 */
export function freezeMatchedDatasetPair(
	previousRunId: number,
	currentRunId: number,
	eligibleHourOffsets?: number[],
	searchResultNames?: {
		previous: Map<number, Set<string>>;
		current: Map<number, Set<string>>;
	}
): MatchedDatasetPair {
	const previous = getDatasetRun(previousRunId);
	const current = getDatasetRun(currentRunId);
	if (!previous || !current) throw new Error('Matched dataset run not found');
	if (
		previous.comparisonMode !== 'matched-hours' ||
		current.comparisonMode !== 'matched-hours' ||
		previous.pairedRunId !== current.id ||
		current.pairedRunId !== previous.id
	) {
		throw new Error('Dataset runs are not a matched-hours pair');
	}

	const requested = previous.matchedHourOffsets.filter((offset) =>
		current.matchedHourOffsets.includes(offset)
	);
	const eligible = eligibleHourOffsets ? new Set(eligibleHourOffsets) : null;
	const previousMembership: Parameters<typeof insertDatasetMembership>[1] = [];
	const currentMembership: Parameters<typeof insertDatasetMembership>[1] = [];
	const includedHourOffsets: number[] = [];
	const excludedHourOffsets: number[] = [];
	let observedPrevious = 0;
	let observedCurrent = 0;

	clearDatasetMembership(previous.id);
	clearDatasetMembership(current.id);

	for (const offset of requested) {
		const previousKey = hourKeyAtOffset(previous.windowStart, offset);
		const currentKey = hourKeyAtOffset(current.windowStart, offset);
		const previousRows = candidatesForHour(previousKey, searchResultNames?.previous.get(offset));
		const currentRows = candidatesForHour(currentKey, searchResultNames?.current.get(offset));
		observedPrevious += previousRows.length;
		observedCurrent += currentRows.length;

		if (
			(eligible && !eligible.has(offset)) ||
			previousRows.length < previous.maxPerHour ||
			currentRows.length < current.maxPerHour
		) {
			excludedHourOffsets.push(offset);
			continue;
		}

		const previousSelected = rankHour(previous, previousKey, previousRows).slice(
			0,
			previous.maxPerHour
		);
		const currentSelected = rankHour(current, currentKey, currentRows).slice(0, current.maxPerHour);
		for (const entry of previousSelected) {
			previousMembership.push({
				repositoryId: entry.row.id,
				timeBucket: previousKey,
				sampleRank: entry.rank,
				inclusionReason: 'matched-hour-sample'
			});
		}
		for (const entry of currentSelected) {
			currentMembership.push({
				repositoryId: entry.row.id,
				timeBucket: currentKey,
				sampleRank: entry.rank,
				inclusionReason: 'matched-hour-sample'
			});
		}
		includedHourOffsets.push(offset);
	}

	insertDatasetMembership(previous.id, previousMembership);
	insertDatasetMembership(current.id, currentMembership);
	const completedAt = new Date().toISOString();
	// Incomplete / sparse hours were excluded from both sides before freeze.
	// The frozen frame itself has no partial members — incompleteness is already
	// reflected in completedShards / expectedShards (requested matched hours).
	for (const run of [previous, current]) {
		updateDatasetRun(run.id, {
			status: 'complete',
			expectedShards: requested.length,
			completedShards: includedHourOffsets.length,
			partialShards: 0,
			failedShards: 0,
			observedRepos: run.id === previous.id ? observedPrevious : observedCurrent,
			sampledRepos: countDatasetMembership(run.id),
			enrichedRepos: countDatasetEnriched(run.id),
			matchedHourOffsets: includedHourOffsets,
			completedAt
		});
	}

	return {
		previous: getDatasetRun(previous.id) ?? previous,
		current: getDatasetRun(current.id) ?? current,
		requestedHourOffsets: requested,
		includedHourOffsets,
		excludedHourOffsets
	};
}

/**
 * Run sample-first matched-pair construction (construction_version >= 2).
 * Older full-ingest construction is no longer used for new matched pairs.
 */
export async function ingestAndFreezeMatchedDatasetPair(
	previousRunId: number,
	currentRunId: number
): Promise<MatchedDatasetPair> {
	const built = await buildMatchedPairSampleFirst({
		previousRunId,
		currentRunId
	});
	return {
		previous: built.previous,
		current: built.current,
		requestedHourOffsets: built.requestedHourOffsets,
		includedHourOffsets: built.includedHourOffsets,
		excludedHourOffsets: built.excludedHourOffsets
	};
}

/**
 * Build a controlled dataset membership set from repositories already present
 * in the archive for this window. Selection is deterministic: same methodology
 * versions + same maxPerHour always pick the same repos regardless of insert order.
 */
export function sampleDatasetFromExistingRepos(runId: number): BackfillDatasetRun {
	const run = getDatasetRun(runId);
	if (!run) throw new Error(`Dataset run #${runId} not found`);

	updateDatasetRun(runId, { status: 'running' });
	clearDatasetMembership(runId);

	const db = getDb();
	const hourKeys = hourKeysForWindow(run.windowStart, run.windowEnd);
	const candidates = db
		.prepare(
			`SELECT id, full_name, created_at, enriched_at
			 FROM repos
			 WHERE created_at >= ? AND created_at < ?
			   AND discovery_source IN ('github_search', 'gharchive')
			 ORDER BY id ASC`
		)
		.all(run.windowStart, run.windowEnd) as CandidateRow[];

	const byBucket = new Map<string, CandidateRow[]>();
	for (const row of candidates) {
		const bucket = hourKeyFromIso(row.created_at);
		const list = byBucket.get(bucket) ?? [];
		list.push(row);
		byBucket.set(bucket, list);
	}

	const membership: Array<{
		repositoryId: number;
		timeBucket: string;
		sampleRank: number;
		inclusionReason: string;
	}> = [];
	const selectedIds = new Set<number>();
	const rankedAll: Array<{
		row: CandidateRow;
		hourKey: string;
		rank: number;
	}> = [];

	let completedShards = 0;
	let partialShards = 0;

	for (const hourKey of hourKeys) {
		const bucketRepos = byBucket.get(hourKey) ?? [];
		const ranked = bucketRepos
			.map((row) => ({
				row,
				hourKey,
				rank: stableSampleRank(run.samplingVersion, hourKey, row.full_name)
			}))
			.sort((a, b) => a.rank - b.rank || a.row.id - b.row.id);

		for (const entry of ranked) rankedAll.push(entry);

		const selected = ranked.slice(0, run.maxPerHour);
		for (const entry of selected) {
			membership.push({
				repositoryId: entry.row.id,
				timeBucket: hourKey,
				sampleRank: entry.rank,
				inclusionReason: 'deterministic-sample'
			});
			selectedIds.add(entry.row.id);
		}

		upsertDatasetShard({
			runId,
			timeBucket: hourKey,
			shardKey: 'hour-sample',
			status: 'completed',
			found: bucketRepos.length,
			inserted: selected.length,
			incomplete: false
		});
		completedShards += 1;
	}

	// Fill toward targetSampleSize with remaining globally ranked repos so sparse
	// hour coverage still yields comparable sample sizes across windows.
	if (membership.length < run.targetSampleSize) {
		rankedAll.sort((a, b) => a.rank - b.rank || a.row.id - b.row.id);
		for (const entry of rankedAll) {
			if (membership.length >= run.targetSampleSize) break;
			if (selectedIds.has(entry.row.id)) continue;
			membership.push({
				repositoryId: entry.row.id,
				timeBucket: entry.hourKey,
				sampleRank: entry.rank,
				inclusionReason: 'deterministic-sample-fill'
			});
			selectedIds.add(entry.row.id);
		}
	}

	insertDatasetMembership(runId, membership);

	const sampledRepos = countDatasetMembership(runId);
	const enrichedRepos = countDatasetEnriched(runId);
	const status = partialShards > 0 ? 'complete' : 'complete';

	updateDatasetRun(runId, {
		status,
		expectedShards: hourKeys.length,
		completedShards,
		partialShards,
		failedShards: 0,
		observedRepos: candidates.length,
		sampledRepos,
		enrichedRepos,
		completedAt: new Date().toISOString()
	});

	const updated = getDatasetRun(runId);
	if (!updated) throw new Error(`Dataset run #${runId} missing after sample`);
	return updated;
}

export function refreshDatasetEnrichmentCounts(runId: number): BackfillDatasetRun {
	const enrichedRepos = countDatasetEnriched(runId);
	updateDatasetRun(runId, { enrichedRepos });
	const run = getDatasetRun(runId);
	if (!run) throw new Error(`Dataset run #${runId} not found`);
	return run;
}

/**
 * Distribution of a dataset's members across the hour-of-window offsets. Used
 * to detect windows that are technically the same size but temporally lopsided
 * (e.g. all repos crammed into six hours from an incomplete search dump).
 */
export function getDatasetTemporalCoverage(run: BackfillDatasetRun): TemporalCoverage {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT time_bucket AS hour, COUNT(*) AS c
			 FROM backfill_dataset_repositories
			 WHERE run_id = ?
			 GROUP BY time_bucket`
		)
		.all(run.id) as { hour: string; c: number }[];

	const total = rows.reduce((sum, row) => sum + row.c, 0);
	const windowStartMs = Date.parse(run.windowStart);
	const hourOffsets: number[] = [];
	let largest = 0;
	let entropy = 0;

	for (const row of rows) {
		largest = Math.max(largest, row.c);
		if (total > 0) {
			const p = row.c / total;
			entropy -= p * Math.log2(p);
		}
		const bucketMs = Date.parse(`${row.hour.slice(0, 10)}T${row.hour.slice(11, 13)}:00:00Z`);
		if (!Number.isNaN(bucketMs)) {
			hourOffsets.push(Math.round((bucketMs - windowStartMs) / 3_600_000));
		}
	}

	return {
		uniqueHoursRepresented: rows.length,
		representedHourRatio: run.expectedShards > 0 ? rows.length / run.expectedShards : 0,
		largestHourShare: total > 0 ? Math.round((largest / total) * 1000) / 1000 : 0,
		hourlyDistributionEntropy: Math.round(entropy * 1000) / 1000,
		hourOffsets: hourOffsets.sort((a, b) => a - b)
	};
}

function sampleCountsByOffset(run: BackfillDatasetRun): Map<number, number> {
	const rows = getDb()
		.prepare(
			`SELECT time_bucket AS hour, COUNT(*) AS c
			 FROM backfill_dataset_repositories
			 WHERE run_id = ?
			 GROUP BY time_bucket`
		)
		.all(run.id) as { hour: string; c: number }[];
	const startMs = Date.parse(run.windowStart);
	const counts = new Map<number, number>();
	for (const row of rows) {
		const bucketMs = Date.parse(`${row.hour.slice(0, 10)}T${row.hour.slice(11, 13)}:00:00Z`);
		if (!Number.isNaN(bucketMs)) {
			counts.set(Math.round((bucketMs - startMs) / 3_600_000), row.c);
		}
	}
	return counts;
}

export function evaluateDatasetComparability(
	current: BackfillDatasetRun,
	previous: BackfillDatasetRun
): DatasetComparability {
	const completedRatio = (run: BackfillDatasetRun) =>
		run.expectedShards > 0 ? run.completedShards / run.expectedShards : 0;

	const currentEnrichment =
		current.sampledRepos > 0 ? current.enrichedRepos / current.sampledRepos : 0;
	const previousEnrichment =
		previous.sampledRepos > 0 ? previous.enrichedRepos / previous.sampledRepos : 0;
	const enrichmentCoverageDifference = Math.abs(currentEnrichment - previousEnrichment);
	const effectiveSampleRatio =
		previous.sampledRepos > 0 ? current.sampledRepos / previous.sampledRepos : null;

	const currentTemporal = getDatasetTemporalCoverage(current);
	const previousTemporal = getDatasetTemporalCoverage(previous);
	const currentOffsets = new Set(currentTemporal.hourOffsets);
	const previousOffsets = new Set(previousTemporal.hourOffsets);
	const unionSize = new Set([...currentOffsets, ...previousOffsets]).size;
	let matchedHourCount = 0;
	for (const offset of currentOffsets) {
		if (previousOffsets.has(offset)) matchedHourCount += 1;
	}
	const matchedHourRatio = unionSize > 0 ? matchedHourCount / unionSize : 0;
	const completedMatchedHourRatio =
		Math.max(current.expectedShards, previous.expectedShards) > 0
			? Math.min(current.completedShards, previous.completedShards) /
				Math.max(current.expectedShards, previous.expectedShards)
			: 0;
	const partialMatchedHours = Math.max(current.partialShards, previous.partialShards);
	const currentHourCounts = sampleCountsByOffset(current);
	const previousHourCounts = sampleCountsByOffset(previous);
	let maxPerHourSampleDifference = 0;
	for (const offset of new Set([...currentHourCounts.keys(), ...previousHourCounts.keys()])) {
		const currentCount = currentHourCounts.get(offset) ?? 0;
		const previousCount = previousHourCounts.get(offset) ?? 0;
		const denominator = Math.max(currentCount, previousCount, 1);
		maxPerHourSampleDifference = Math.max(
			maxPerHourSampleDifference,
			Math.abs(currentCount - previousCount) / denominator
		);
	}
	maxPerHourSampleDifference = Math.round(maxPerHourSampleDifference * 1000) / 1000;

	const matchedMode = current.comparisonMode === 'matched-hours';
	const temporalComparable = matchedMode
		? matchedHourCount >= MIN_UNIQUE_HOURS &&
			completedMatchedHourRatio >= 0.9 &&
			partialMatchedHours === 0 &&
			maxPerHourSampleDifference <= 0.1 &&
			previousTemporal.largestHourShare <= MAX_LARGEST_HOUR_SHARE &&
			currentTemporal.largestHourShare <= MAX_LARGEST_HOUR_SHARE
		: previousTemporal.uniqueHoursRepresented >= MIN_UNIQUE_HOURS &&
			currentTemporal.uniqueHoursRepresented >= MIN_UNIQUE_HOURS &&
			previousTemporal.largestHourShare <= MAX_LARGEST_HOUR_SHARE &&
			currentTemporal.largestHourShare <= MAX_LARGEST_HOUR_SHARE &&
			matchedHourRatio >= MIN_MATCHED_HOUR_RATIO;

	let growthSuppressedReason: string | null = null;

	if (current.comparisonMode !== previous.comparisonMode) {
		growthSuppressedReason = 'different-comparison-modes';
	} else if (current.comparisonMode === 'absolute') {
		growthSuppressedReason = 'absolute-density-only';
	} else if (
		current.source !== previous.source ||
		current.queryVersion !== previous.queryVersion ||
		current.shardingVersion !== previous.shardingVersion ||
		current.deduplicationVersion !== previous.deduplicationVersion ||
		current.samplingVersion !== previous.samplingVersion ||
		current.constructionVersion !== previous.constructionVersion ||
		current.candidatePoolSize !== previous.candidatePoolSize ||
		current.maxPerHour !== previous.maxPerHour ||
		current.targetSampleSize !== previous.targetSampleSize
	) {
		growthSuppressedReason = 'different-sampling-plans';
	} else if (
		matchedMode &&
		(current.pairedRunId !== previous.id || previous.pairedRunId !== current.id)
	) {
		growthSuppressedReason = 'not-paired-datasets';
	} else if (matchedMode && matchedHourCount < MIN_UNIQUE_HOURS) {
		growthSuppressedReason = 'insufficient-matched-hours';
	} else if (matchedMode && completedMatchedHourRatio < 0.9) {
		growthSuppressedReason = 'incomplete-matched-hours';
	} else if (matchedMode && partialMatchedHours > 0) {
		growthSuppressedReason = 'partial-matched-hours';
	} else if (matchedMode && maxPerHourSampleDifference > 0.1) {
		growthSuppressedReason = 'per-hour-sample-imbalance';
	} else if (
		completedRatio(current) < 0.9 ||
		completedRatio(previous) < 0.9
	) {
		growthSuppressedReason = 'incomplete-search-shards';
	} else if (current.partialShards > 0 || previous.partialShards > 0) {
		growthSuppressedReason = 'partial-search-results';
	} else if (
		effectiveSampleRatio == null ||
		effectiveSampleRatio < 0.8 ||
		effectiveSampleRatio > 1.25
	) {
		growthSuppressedReason = 'sample-size-imbalance';
	} else if (enrichmentCoverageDifference > 0.1) {
		growthSuppressedReason = 'enrichment-coverage-imbalance';
	} else if (
		previousTemporal.uniqueHoursRepresented < MIN_UNIQUE_HOURS ||
		currentTemporal.uniqueHoursRepresented < MIN_UNIQUE_HOURS
	) {
		growthSuppressedReason = 'insufficient-temporal-distribution';
	} else if (
		previousTemporal.largestHourShare > MAX_LARGEST_HOUR_SHARE ||
		currentTemporal.largestHourShare > MAX_LARGEST_HOUR_SHARE
	) {
		growthSuppressedReason = 'hour-concentration-imbalance';
	} else if (matchedHourRatio < MIN_MATCHED_HOUR_RATIO) {
		growthSuppressedReason = 'different-represented-hours';
	}

	return {
		comparable: growthSuppressedReason === null,
		growthSuppressedReason,
		current,
		previous,
		effectiveSampleRatio,
		enrichmentCoverageDifference,
		currentTemporal,
		previousTemporal,
		matchedHourCount,
		matchedHourRatio: Math.round(matchedHourRatio * 1000) / 1000,
		completedMatchedHourRatio: Math.round(completedMatchedHourRatio * 1000) / 1000,
		partialMatchedHours,
		maxPerHourSampleDifference,
		temporalComparable
	};
}

export function createPairedDatasetRuns(opts: {
	previousStart: string;
	previousEnd: string;
	currentStart: string;
	currentEnd: string;
	maxPerHour?: number;
	targetSampleSize?: number;
	comparisonMode?: 'absolute' | 'full-window';
}): { previous: BackfillDatasetRun; current: BackfillDatasetRun } {
	const shared = {
		comparisonMode: opts.comparisonMode ?? ('absolute' as const),
		maxPerHour: opts.maxPerHour ?? 9,
		targetSampleSize: opts.targetSampleSize ?? 1500,
		queryVersion: DATASET_QUERY_VERSION,
		shardingVersion: DATASET_SHARDING_VERSION,
		deduplicationVersion: DATASET_DEDUPLICATION_VERSION,
		samplingVersion: DATASET_SAMPLING_VERSION
	};
	const previous = createDatasetRun({
		windowStart: opts.previousStart,
		windowEnd: opts.previousEnd,
		...shared
	});
	const current = createDatasetRun({
		windowStart: opts.currentStart,
		windowEnd: opts.currentEnd,
		...shared
	});
	return { previous, current };
}

/**
 * Which hour-of-window offsets actually contain repos in this window. Used to
 * derive a defensible matched-hour comparison when full weeks are not available.
 */
export function representedHourOffsets(windowStart: string, windowEnd: string): number[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT DISTINCT substr(created_at, 12, 2) AS hh, substr(created_at, 1, 10) AS day
			 FROM repos
			 WHERE created_at >= ? AND created_at < ?
			   AND discovery_source IN ('github_search', 'gharchive')`
		)
		.all(windowStart, windowEnd) as { hh: string; day: string }[];
	const startMs = Date.parse(windowStart);
	const offsets = new Set<number>();
	for (const row of rows) {
		const ms = Date.parse(`${row.day}T${row.hh}:00:00Z`);
		if (!Number.isNaN(ms)) offsets.add(Math.round((ms - startMs) / 3_600_000));
	}
	return [...offsets].sort((a, b) => a - b);
}
