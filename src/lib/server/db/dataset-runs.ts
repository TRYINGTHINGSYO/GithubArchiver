import { createHash } from 'node:crypto';
import { getDb } from './connection.js';
import type { RepoRow } from './types.js';

export const DATASET_QUERY_VERSION = 2;
export const DATASET_SHARDING_VERSION = 2;
export const DATASET_DEDUPLICATION_VERSION = 1;
export const DATASET_SAMPLING_VERSION = 2;
/** Sample-first matched construction: search shards → bounded pool → insert selected only. */
export const DATASET_CONSTRUCTION_VERSION = 2;
export const DEFAULT_CANDIDATE_POOL_SIZE = 100;

export type DatasetRunSource = 'github-search';
export type DatasetRunStatus = 'pending' | 'running' | 'paused' | 'complete' | 'failed';
export type DatasetShardStatus = 'pending' | 'completed' | 'partial' | 'failed';
export type DatasetComparisonMode = 'absolute' | 'full-window' | 'matched-hours';

export type BackfillDatasetRun = {
	id: number;
	source: DatasetRunSource;
	windowStart: string;
	windowEnd: string;
	queryVersion: number;
	shardingVersion: number;
	deduplicationVersion: number;
	samplingVersion: number;
	constructionVersion: number;
	candidatePoolSize: number;
	comparisonMode: DatasetComparisonMode;
	matchedHourOffsets: number[];
	pairedRunId: number | null;
	maxPerHour: number;
	targetSampleSize: number;
	expectedShards: number;
	completedShards: number;
	partialShards: number;
	failedShards: number;
	observedRepos: number;
	sampledRepos: number;
	enrichedRepos: number;
	status: DatasetRunStatus;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
};

type DatasetRunRow = {
	id: number;
	source: string;
	window_start: string;
	window_end: string;
	query_version: number;
	sharding_version: number;
	deduplication_version: number;
	sampling_version: number;
	construction_version: number;
	candidate_pool_size: number;
	comparison_mode: string;
	matched_hour_offsets_json: string;
	paired_run_id: number | null;
	max_per_hour: number;
	target_sample_size: number;
	expected_shards: number;
	completed_shards: number;
	partial_shards: number;
	failed_shards: number;
	observed_repos: number;
	sampled_repos: number;
	enriched_repos: number;
	status: string;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
};

function mapRun(row: DatasetRunRow): BackfillDatasetRun {
	return {
		id: row.id,
		source: row.source as DatasetRunSource,
		windowStart: row.window_start,
		windowEnd: row.window_end,
		queryVersion: row.query_version,
		shardingVersion: row.sharding_version,
		deduplicationVersion: row.deduplication_version,
		samplingVersion: row.sampling_version,
		constructionVersion: row.construction_version ?? 1,
		candidatePoolSize: row.candidate_pool_size ?? DEFAULT_CANDIDATE_POOL_SIZE,
		comparisonMode: row.comparison_mode as DatasetComparisonMode,
		matchedHourOffsets: parseHourOffsets(row.matched_hour_offsets_json),
		pairedRunId: row.paired_run_id,
		maxPerHour: row.max_per_hour,
		targetSampleSize: row.target_sample_size,
		expectedShards: row.expected_shards,
		completedShards: row.completed_shards,
		partialShards: row.partial_shards,
		failedShards: row.failed_shards,
		observedRepos: row.observed_repos,
		sampledRepos: row.sampled_repos,
		enrichedRepos: row.enriched_repos,
		status: row.status as DatasetRunStatus,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		completedAt: row.completed_at
	};
}

function parseHourOffsets(value: string): number[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((offset): offset is number => Number.isInteger(offset) && offset >= 0)
			: [];
	} catch {
		return [];
	}
}

/** Stable unsigned 32-bit rank from methodology + hour + repo identity. */
export function stableSampleRank(
	samplingVersion: number,
	timeBucket: string,
	fullName: string
): number {
	const digest = createHash('sha256')
		.update(`${samplingVersion}:${timeBucket}:${fullName.toLowerCase()}`)
		.digest();
	return digest.readUInt32BE(0);
}

export function createDatasetRun(opts: {
	windowStart: string;
	windowEnd: string;
	source?: DatasetRunSource;
	queryVersion?: number;
	shardingVersion?: number;
	deduplicationVersion?: number;
	samplingVersion?: number;
	constructionVersion?: number;
	candidatePoolSize?: number;
	comparisonMode?: DatasetComparisonMode;
	matchedHourOffsets?: number[];
	pairedRunId?: number | null;
	maxPerHour?: number;
	targetSampleSize?: number;
}): BackfillDatasetRun {
	const db = getDb();
	const now = new Date().toISOString();
	const hoursExpected = Math.max(
		0,
		Math.round((Date.parse(opts.windowEnd) - Date.parse(opts.windowStart)) / 3_600_000)
	);
	const result = db
		.prepare(
			`INSERT INTO backfill_dataset_runs (
			   source, window_start, window_end,
			   query_version, sharding_version, deduplication_version, sampling_version,
			   construction_version, candidate_pool_size,
			   comparison_mode, matched_hour_offsets_json, paired_run_id,
			   max_per_hour, target_sample_size, expected_shards, status, created_at, updated_at
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
		)
		.run(
			opts.source ?? 'github-search',
			opts.windowStart,
			opts.windowEnd,
			opts.queryVersion ?? DATASET_QUERY_VERSION,
			opts.shardingVersion ?? DATASET_SHARDING_VERSION,
			opts.deduplicationVersion ?? DATASET_DEDUPLICATION_VERSION,
			opts.samplingVersion ?? DATASET_SAMPLING_VERSION,
			opts.constructionVersion ?? DATASET_CONSTRUCTION_VERSION,
			opts.candidatePoolSize ?? DEFAULT_CANDIDATE_POOL_SIZE,
			opts.comparisonMode ?? 'absolute',
			JSON.stringify(opts.matchedHourOffsets ?? []),
			opts.pairedRunId ?? null,
			opts.maxPerHour ?? 9,
			opts.targetSampleSize ?? 1500,
			opts.comparisonMode === 'matched-hours'
				? (opts.matchedHourOffsets?.length ?? 0)
				: hoursExpected,
			now,
			now
		);
	const run = getDatasetRun(Number(result.lastInsertRowid));
	if (!run) throw new Error('failed to create dataset run');
	return run;
}

export function getDatasetRun(id: number): BackfillDatasetRun | null {
	const row = getDb()
		.prepare('SELECT * FROM backfill_dataset_runs WHERE id = ?')
		.get(id) as DatasetRunRow | undefined;
	return row ? mapRun(row) : null;
}

export function listDatasetRuns(limit = 20): BackfillDatasetRun[] {
	return (
		getDb()
			.prepare('SELECT * FROM backfill_dataset_runs ORDER BY id DESC LIMIT ?')
			.all(limit) as DatasetRunRow[]
	).map(mapRun);
}

export function updateDatasetRun(
	id: number,
	patch: Partial<{
		status: DatasetRunStatus;
		expectedShards: number;
		completedShards: number;
		partialShards: number;
		failedShards: number;
		observedRepos: number;
		sampledRepos: number;
		enrichedRepos: number;
		completedAt: string | null;
			pairedRunId: number | null;
			matchedHourOffsets: number[];
	}>
): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE backfill_dataset_runs SET
		   status = COALESCE(?, status),
		   expected_shards = COALESCE(?, expected_shards),
		   completed_shards = COALESCE(?, completed_shards),
		   partial_shards = COALESCE(?, partial_shards),
		   failed_shards = COALESCE(?, failed_shards),
		   observed_repos = COALESCE(?, observed_repos),
		   sampled_repos = COALESCE(?, sampled_repos),
		   enriched_repos = COALESCE(?, enriched_repos),
		   completed_at = COALESCE(?, completed_at),
			paired_run_id = COALESCE(?, paired_run_id),
			matched_hour_offsets_json = COALESCE(?, matched_hour_offsets_json),
		   updated_at = ?
		 WHERE id = ?`
	).run(
		patch.status ?? null,
		patch.expectedShards ?? null,
		patch.completedShards ?? null,
		patch.partialShards ?? null,
		patch.failedShards ?? null,
		patch.observedRepos ?? null,
		patch.sampledRepos ?? null,
		patch.enrichedRepos ?? null,
		patch.completedAt ?? null,
		patch.pairedRunId ?? null,
		patch.matchedHourOffsets ? JSON.stringify(patch.matchedHourOffsets) : null,
		now,
		id
	);
}

export function clearDatasetMembership(runId: number): void {
	getDb().prepare('DELETE FROM backfill_dataset_repositories WHERE run_id = ?').run(runId);
}

export function clearDatasetMembershipForHour(runId: number, timeBucket: string): void {
	getDb()
		.prepare('DELETE FROM backfill_dataset_repositories WHERE run_id = ? AND time_bucket = ?')
		.run(runId, timeBucket);
}

export function listCompletedMatchedHourBuckets(runId: number): string[] {
	return (
		getDb()
			.prepare(
				`SELECT time_bucket FROM backfill_dataset_shards
				 WHERE run_id = ? AND shard_key = 'matched-hour-sample-first' AND status = 'completed'
				 ORDER BY time_bucket`
			)
			.all(runId) as { time_bucket: string }[]
	).map((row) => row.time_bucket);
}

export function getDatasetShard(
	runId: number,
	timeBucket: string,
	shardKey: string
): { status: string; found: number; inserted: number; incomplete: number; error: string | null } | null {
	return (
		(getDb()
			.prepare(
				`SELECT status, found, inserted, incomplete, error FROM backfill_dataset_shards
				 WHERE run_id = ? AND time_bucket = ? AND shard_key = ?`
			)
			.get(runId, timeBucket, shardKey) as
			| { status: string; found: number; inserted: number; incomplete: number; error: string | null }
			| undefined) ?? null
	);
}

export function insertDatasetMembership(
	runId: number,
	rows: Array<{
		repositoryId: number;
		timeBucket: string;
		sampleRank: number;
		inclusionReason: string;
	}>
): void {
	const db = getDb();
	const insert = db.prepare(
		`INSERT OR REPLACE INTO backfill_dataset_repositories
		 (run_id, repository_id, time_bucket, sample_rank, inclusion_reason)
		 VALUES (?, ?, ?, ?, ?)`
	);
	const tx = db.transaction(() => {
		for (const row of rows) {
			insert.run(runId, row.repositoryId, row.timeBucket, row.sampleRank, row.inclusionReason);
		}
	});
	tx();
}

export function countDatasetMembership(runId: number): number {
	return (
		getDb()
			.prepare('SELECT COUNT(*) AS c FROM backfill_dataset_repositories WHERE run_id = ?')
			.get(runId) as { c: number }
	).c;
}

export function countDatasetEnriched(runId: number): number {
	return (
		getDb()
			.prepare(
				`SELECT COUNT(*) AS c
				 FROM backfill_dataset_repositories d
				 JOIN repos r ON r.id = d.repository_id
				 WHERE d.run_id = ? AND r.enriched_at IS NOT NULL`
			)
			.get(runId) as { c: number }
	).c;
}

export function listDatasetRepoIds(runId: number): number[] {
	return (
		getDb()
			.prepare('SELECT repository_id FROM backfill_dataset_repositories WHERE run_id = ?')
			.all(runId) as { repository_id: number }[]
	).map((row) => row.repository_id);
}

/**
 * Un-enriched members of a dataset, ordered by sample_rank so interrupted runs
 * resume deterministically. Membership itself is never modified by enrichment.
 */
export function listUnenrichedDatasetRepos(runId: number, limit: number): RepoRow[] {
	return getDb()
		.prepare(
			`SELECT r.*
			 FROM backfill_dataset_repositories d
			 JOIN repos r ON r.id = d.repository_id
			 WHERE d.run_id = ?
			   AND COALESCE(r.enrichment_level, 0) < 1
			   AND r.enriched_at IS NULL
			   AND r.deleted_at IS NULL
			 ORDER BY d.sample_rank ASC
			 LIMIT ?`
		)
		.all(runId, limit) as RepoRow[];
}

export type DatasetEnrichmentProgress = {
	members: number;
	enriched: number;
	deleted: number;
	failed: number;
	remaining: number;
	effectiveCoverage: number;
};

/** Terminal-status accounting for a dataset without ever mutating membership. */
export function getDatasetEnrichmentProgress(runId: number): DatasetEnrichmentProgress {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT
			   COUNT(*) AS members,
			   SUM(CASE WHEN r.enriched_at IS NOT NULL AND COALESCE(r.enrichment_level, 0) >= 1 THEN 1 ELSE 0 END) AS enriched,
			   SUM(CASE WHEN r.deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted
			 FROM backfill_dataset_repositories d
			 JOIN repos r ON r.id = d.repository_id
			 WHERE d.run_id = ?`
		)
		.get(runId) as { members: number; enriched: number; deleted: number };

	const failed = (
		db
			.prepare(
				`SELECT COUNT(DISTINCT r.id) AS c
				 FROM backfill_dataset_repositories d
				 JOIN repos r ON r.id = d.repository_id
				 JOIN repository_events e ON e.repo_id = r.id
				 WHERE d.run_id = ?
				   AND e.event_type = 'enrichment_failed'
				   AND r.enriched_at IS NULL
				   AND r.deleted_at IS NULL`
			)
			.get(runId) as { c: number }
	).c;

	const members = row.members ?? 0;
	const enriched = row.enriched ?? 0;
	const deleted = row.deleted ?? 0;
	const remaining = Math.max(0, members - enriched - deleted);
	// Effective coverage = enriched share of members that still exist (exclude deleted).
	const denominator = Math.max(0, members - deleted);
	const effectiveCoverage = denominator > 0 ? Math.round((enriched / denominator) * 1000) / 1000 : 0;
	return { members, enriched, deleted, failed, remaining, effectiveCoverage };
}

export function upsertDatasetShard(opts: {
	runId: number;
	timeBucket: string;
	shardKey: string;
	status: DatasetShardStatus;
	found?: number;
	inserted?: number;
	incomplete?: boolean;
	error?: string | null;
}): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO backfill_dataset_shards
		 (run_id, time_bucket, shard_key, status, found, inserted, incomplete, error, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(run_id, time_bucket, shard_key) DO UPDATE SET
		   status = excluded.status,
		   found = excluded.found,
		   inserted = excluded.inserted,
		   incomplete = excluded.incomplete,
		   error = excluded.error,
		   updated_at = excluded.updated_at`
	).run(
		opts.runId,
		opts.timeBucket,
		opts.shardKey,
		opts.status,
		opts.found ?? 0,
		opts.inserted ?? 0,
		opts.incomplete ? 1 : 0,
		opts.error ?? null,
		now
	);
}

export function recountDatasetShards(runId: number): {
	expected: number;
	completed: number;
	partial: number;
	failed: number;
} {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT status, COUNT(*) AS c FROM backfill_dataset_shards
			 WHERE run_id = ? GROUP BY status`
		)
		.all(runId) as { status: string; c: number }[];
	const counts = { expected: 0, completed: 0, partial: 0, failed: 0 };
	for (const row of rows) {
		counts.expected += row.c;
		if (row.status === 'completed') counts.completed = row.c;
		else if (row.status === 'partial') counts.partial = row.c;
		else if (row.status === 'failed') counts.failed = row.c;
	}
	return counts;
}
