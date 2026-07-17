import {
	clearDatasetMembershipForHour,
	countDatasetEnriched,
	countDatasetMembership,
	getDatasetRun,
	getDatasetShard,
	insertDatasetMembership,
	stableSampleRank,
	updateDatasetRun,
	upsertDatasetShard,
	type BackfillDatasetRun,
	DATASET_CONSTRUCTION_VERSION,
	DEFAULT_CANDIDATE_POOL_SIZE
} from '$lib/server/db/dataset-runs';
import { getDb } from '$lib/server/db/connection';
import { appendRepoEvent } from '$lib/server/events';
import {
	GitHubRateLimitError,
	searchRepositories,
	type GitHubSearchRepoItem,
	type GitHubSearchRepoResponse
} from '$lib/server/github';
import { createdRangeQuery } from '$lib/server/repo-discovery';
import { insertRepo } from '$lib/server/db';

export const MATCHED_SAMPLE_FIRST_SHARD_KEY = 'matched-hour-sample-first';
export const SEARCH_PAGE_SIZE = 100;

export type MatchedSearchFn = (
	query: string,
	page: number,
	perPage: number
) => Promise<GitHubSearchRepoResponse>;

export type SampleFirstCandidate = {
	fullName: string;
	owner: string;
	name: string;
	githubUrl: string;
	githubId: number;
	createdAt: string;
};

export type HourCandidatePool = {
	hourKey: string;
	candidates: SampleFirstCandidate[];
	shardsQueried: number;
	pagesFetched: number;
	incomplete: boolean;
	poolFull: boolean;
};

export type SampleFirstHourResult = {
	offset: number;
	included: boolean;
	previous: HourCandidatePool;
	current: HourCandidatePool;
	previousSelected: number;
	currentSelected: number;
	reason?: string;
};

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function hourKeyFromIso(iso: string): string {
	return `${iso.slice(0, 10)}-${iso.slice(11, 13)}`;
}

export function hourKeyAtOffset(windowStart: string, offset: number): string {
	return hourKeyFromIso(new Date(Date.parse(windowStart) + offset * 3_600_000).toISOString());
}

/** Deterministic minute-of-hour shard order for sample-first construction. */
export function matchedMinuteShardOrder(): number[] {
	return Array.from({ length: 60 }, (_, minute) => minute);
}

export function minuteShardWindow(hourKey: string, minute: number): { start: Date; end: Date } {
	const start = new Date(`${hourKey.slice(0, 10)}T${hourKey.slice(11, 13)}:${String(minute).padStart(2, '0')}:00.000Z`);
	const end = new Date(start.getTime() + 60_000 - 1);
	return { start, end };
}

/**
 * Shared GitHub Search rate limiter. Concurrency must not affect membership —
 * only the order of network waits — so shard order stays fixed per hour.
 */
export class SharedSearchRateLimiter {
	private chain: Promise<void> = Promise.resolve();
	private lastAt = 0;

	constructor(private readonly minIntervalMs: number) {}

	schedule<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.chain.then(async () => {
			const wait = Math.max(0, this.minIntervalMs - (Date.now() - this.lastAt));
			if (wait > 0) await sleep(wait);
			this.lastAt = Date.now();
			return fn();
		});
		this.chain = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}
}

function toCandidate(item: GitHubSearchRepoItem): SampleFirstCandidate | null {
	const [owner, name] = item.full_name.split('/');
	if (!owner || !name) return null;
	return {
		fullName: item.full_name,
		owner,
		name,
		githubUrl: item.html_url,
		githubId: item.id,
		createdAt: item.created_at
	};
}

/**
 * Collect a bounded candidate reservoir for one hour by walking fixed minute
 * shards in order. Stops early once the pool is full. Does not write to repos.
 */
export async function collectHourCandidatePool(opts: {
	hourKey: string;
	candidatePoolSize: number;
	searchFn: MatchedSearchFn;
	limiter?: SharedSearchRateLimiter;
}): Promise<HourCandidatePool> {
	const byName = new Map<string, SampleFirstCandidate>();
	let shardsQueried = 0;
	let pagesFetched = 0;
	let incomplete = false;

	for (const minute of matchedMinuteShardOrder()) {
		if (byName.size >= opts.candidatePoolSize) break;

		const { start, end } = minuteShardWindow(opts.hourKey, minute);
		const query = createdRangeQuery(start, end);
		shardsQueried += 1;

		for (let page = 1; page <= 10; page++) {
			if (byName.size >= opts.candidatePoolSize) break;

			const response = opts.limiter
				? await opts.limiter.schedule(() => opts.searchFn(query, page, SEARCH_PAGE_SIZE))
				: await opts.searchFn(query, page, SEARCH_PAGE_SIZE);
			pagesFetched += 1;
			if (response.incomplete_results) incomplete = true;

			for (const item of response.items) {
				const candidate = toCandidate(item);
				if (!candidate) continue;
				const key = candidate.fullName.toLowerCase();
				if (!byName.has(key)) byName.set(key, candidate);
				if (byName.size >= opts.candidatePoolSize) break;
			}

			if (response.items.length < SEARCH_PAGE_SIZE) break;
		}
	}

	return {
		hourKey: opts.hourKey,
		candidates: [...byName.values()],
		shardsQueried,
		pagesFetched,
		incomplete,
		poolFull: byName.size >= opts.candidatePoolSize
	};
}

export function selectSampleFromPool(
	pool: HourCandidatePool,
	samplingVersion: number,
	samplePerHour: number
): Array<SampleFirstCandidate & { sampleRank: number }> {
	return pool.candidates
		.map((candidate) => ({
			...candidate,
			sampleRank: stableSampleRank(samplingVersion, pool.hourKey, candidate.fullName)
		}))
		.sort(
			(a, b) =>
				a.sampleRank - b.sampleRank || a.fullName.localeCompare(b.fullName) || a.githubId - b.githubId
		)
		.slice(0, samplePerHour);
}

function persistSelectedRepos(
	run: BackfillDatasetRun,
	hourKey: string,
	selected: Array<SampleFirstCandidate & { sampleRank: number }>
): number {
	const db = getDb();
	const firstSeenAt = new Date().toISOString();
	const membership: Array<{
		repositoryId: number;
		timeBucket: string;
		sampleRank: number;
		inclusionReason: string;
	}> = [];

	const tx = db.transaction(() => {
		clearDatasetMembershipForHour(run.id, hourKey);
		for (const candidate of selected) {
			const result = insertRepo({
				owner: candidate.owner,
				name: candidate.name,
				full_name: candidate.fullName,
				github_url: candidate.githubUrl,
				event_id: `github_search:${candidate.githubId}`,
				created_at: candidate.createdAt,
				first_seen_at: firstSeenAt,
				discovery_source: 'github_search'
			});
			let repoId = result.id;
			if (!repoId) {
				const existing = db
					.prepare('SELECT id FROM repos WHERE full_name = ? COLLATE NOCASE')
					.get(candidate.fullName) as { id: number } | undefined;
				repoId = existing?.id;
			}
			if (!repoId) continue;
			if (result.status === 'inserted') {
				appendRepoEvent(
					repoId,
					'first_seen',
					{
						full_name: candidate.fullName,
						github_url: candidate.githubUrl,
						event_id: `github_search:${candidate.githubId}`,
						created_at: candidate.createdAt,
						discovery_source: 'github_search',
						dataset_run_id: run.id,
						construction: 'sample-first'
					},
					candidate.createdAt
				);
			}
			membership.push({
				repositoryId: repoId,
				timeBucket: hourKey,
				sampleRank: candidate.sampleRank,
				inclusionReason: 'matched-hour-sample-first'
			});
		}
		insertDatasetMembership(run.id, membership);
	});
	tx();
	return membership.length;
}

async function processMatchedOffset(opts: {
	offset: number;
	previous: BackfillDatasetRun;
	current: BackfillDatasetRun;
	searchFn: MatchedSearchFn;
	limiter: SharedSearchRateLimiter;
}): Promise<SampleFirstHourResult> {
	const previousKey = hourKeyAtOffset(opts.previous.windowStart, opts.offset);
	const currentKey = hourKeyAtOffset(opts.current.windowStart, opts.offset);

	const prevDone = getDatasetShard(opts.previous.id, previousKey, MATCHED_SAMPLE_FIRST_SHARD_KEY);
	const currDone = getDatasetShard(opts.current.id, currentKey, MATCHED_SAMPLE_FIRST_SHARD_KEY);
	if (prevDone?.status === 'completed' && currDone?.status === 'completed') {
		return {
			offset: opts.offset,
			included: true,
			previous: {
				hourKey: previousKey,
				candidates: [],
				shardsQueried: 0,
				pagesFetched: 0,
				incomplete: false,
				poolFull: true
			},
			current: {
				hourKey: currentKey,
				candidates: [],
				shardsQueried: 0,
				pagesFetched: 0,
				incomplete: false,
				poolFull: true
			},
			previousSelected: prevDone.inserted,
			currentSelected: currDone.inserted
		};
	}

	if (
		opts.previous.candidatePoolSize !== opts.current.candidatePoolSize ||
		opts.previous.shardingVersion !== opts.current.shardingVersion ||
		opts.previous.samplingVersion !== opts.current.samplingVersion ||
		opts.previous.constructionVersion !== opts.current.constructionVersion ||
		opts.previous.maxPerHour !== opts.current.maxPerHour
	) {
		throw new Error('Matched pair methodology mismatch — refusing to process offset');
	}

	const poolSize = opts.previous.candidatePoolSize || DEFAULT_CANDIDATE_POOL_SIZE;

	// Collect both sides with the shared limiter so concurrency cannot reorder shard plans.
	const previousPool = await collectHourCandidatePool({
		hourKey: previousKey,
		candidatePoolSize: poolSize,
		searchFn: opts.searchFn,
		limiter: opts.limiter
	});
	const currentPool = await collectHourCandidatePool({
		hourKey: currentKey,
		candidatePoolSize: poolSize,
		searchFn: opts.searchFn,
		limiter: opts.limiter
	});

	const incomplete = previousPool.incomplete || currentPool.incomplete;
	const previousSelected = selectSampleFromPool(
		previousPool,
		opts.previous.samplingVersion,
		opts.previous.maxPerHour
	);
	const currentSelected = selectSampleFromPool(
		currentPool,
		opts.current.samplingVersion,
		opts.current.maxPerHour
	);

	const enough =
		!incomplete &&
		previousSelected.length >= opts.previous.maxPerHour &&
		currentSelected.length >= opts.current.maxPerHour;

	if (!enough) {
		const reason = incomplete
			? 'incomplete-search-results'
			: 'insufficient-candidates';
		for (const [run, key, pool] of [
			[opts.previous, previousKey, previousPool],
			[opts.current, currentKey, currentPool]
		] as const) {
			clearDatasetMembershipForHour(run.id, key);
			upsertDatasetShard({
				runId: run.id,
				timeBucket: key,
				shardKey: MATCHED_SAMPLE_FIRST_SHARD_KEY,
				status: incomplete ? 'partial' : 'failed',
				found: pool.candidates.length,
				inserted: 0,
				incomplete,
				error: reason
			});
		}
		return {
			offset: opts.offset,
			included: false,
			previous: previousPool,
			current: currentPool,
			previousSelected: 0,
			currentSelected: 0,
			reason
		};
	}

	const prevInserted = persistSelectedRepos(opts.previous, previousKey, previousSelected);
	const currInserted = persistSelectedRepos(opts.current, currentKey, currentSelected);

	upsertDatasetShard({
		runId: opts.previous.id,
		timeBucket: previousKey,
		shardKey: MATCHED_SAMPLE_FIRST_SHARD_KEY,
		status: 'completed',
		found: previousPool.candidates.length,
		inserted: prevInserted,
		incomplete: false
	});
	upsertDatasetShard({
		runId: opts.current.id,
		timeBucket: currentKey,
		shardKey: MATCHED_SAMPLE_FIRST_SHARD_KEY,
		status: 'completed',
		found: currentPool.candidates.length,
		inserted: currInserted,
		incomplete: false
	});

	return {
		offset: opts.offset,
		included: true,
		previous: previousPool,
		current: currentPool,
		previousSelected: prevInserted,
		currentSelected: currInserted
	};
}

async function mapPool<T, R>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
		while (true) {
			const index = next;
			next += 1;
			if (index >= items.length) return;
			results[index] = await worker(items[index]);
		}
	});
	await Promise.all(runners);
	return results;
}

export type SampleFirstBuildResult = {
	previous: BackfillDatasetRun;
	current: BackfillDatasetRun;
	requestedHourOffsets: number[];
	includedHourOffsets: number[];
	excludedHourOffsets: number[];
	hourResults: SampleFirstHourResult[];
};

/**
 * Sample-first matched-pair construction. Searches fixed minute shards, keeps a
 * bounded candidate pool, and persists only the selected sample into repos +
 * immutable membership. Resumes completed hours without re-querying them.
 */
export async function buildMatchedPairSampleFirst(opts: {
	previousRunId: number;
	currentRunId: number;
	concurrency?: number;
	searchDelayMs?: number;
	searchFn?: MatchedSearchFn;
}): Promise<SampleFirstBuildResult> {
	const previous = getDatasetRun(opts.previousRunId);
	const current = getDatasetRun(opts.currentRunId);
	if (!previous || !current) throw new Error('Matched dataset run not found');
	if (
		previous.comparisonMode !== 'matched-hours' ||
		current.comparisonMode !== 'matched-hours' ||
		previous.pairedRunId !== current.id ||
		current.pairedRunId !== previous.id
	) {
		throw new Error('Dataset runs are not a matched-hours pair');
	}
	if (
		previous.constructionVersion < DATASET_CONSTRUCTION_VERSION ||
		current.constructionVersion < DATASET_CONSTRUCTION_VERSION
	) {
		throw new Error(
			'Sample-first construction requires construction_version >= 2. Create a new matched pair.'
		);
	}

	const requested = previous.matchedHourOffsets.filter((offset) =>
		current.matchedHourOffsets.includes(offset)
	);
	const concurrency = Math.max(1, opts.concurrency ?? Number(process.env.DATASET_MATCHED_CONCURRENCY ?? 2));
	const searchDelayMs = opts.searchDelayMs ?? Number(process.env.SEARCH_PAGE_DELAY_MS ?? 200);
	const limiter = new SharedSearchRateLimiter(searchDelayMs);
	const searchFn = opts.searchFn ?? ((query, page, perPage) => searchRepositories(query, page, perPage));

	updateDatasetRun(previous.id, { status: 'running' });
	updateDatasetRun(current.id, { status: 'running' });

	const pendingOffsets = requested.filter((offset) => {
		const previousKey = hourKeyAtOffset(previous.windowStart, offset);
		const currentKey = hourKeyAtOffset(current.windowStart, offset);
		const prev = getDatasetShard(previous.id, previousKey, MATCHED_SAMPLE_FIRST_SHARD_KEY);
		const curr = getDatasetShard(current.id, currentKey, MATCHED_SAMPLE_FIRST_SHARD_KEY);
		return !(prev?.status === 'completed' && curr?.status === 'completed');
	});

	console.log(
		`Sample-first matched construction: ${requested.length} offsets, ${pendingOffsets.length} remaining, concurrency=${concurrency}, pool=${previous.candidatePoolSize}, sample/hour=${previous.maxPerHour}`
	);

	const hourResults: SampleFirstHourResult[] = [];
	try {
		const processed = await mapPool(pendingOffsets, concurrency, async (offset) => {
			console.log(`  offset ${offset}: collecting candidate pools...`);
			const result = await processMatchedOffset({
				offset,
				previous,
				current,
				searchFn,
				limiter
			});
			console.log(
				`  offset ${offset}: ${result.included ? 'included' : `excluded (${result.reason})`}  prev=${result.previous.candidates.length}→${result.previousSelected}  curr=${result.current.candidates.length}→${result.currentSelected}`
			);
			return result;
		});
		hourResults.push(...processed);
	} catch (error) {
		if (error instanceof GitHubRateLimitError) {
			updateDatasetRun(previous.id, { status: 'paused' });
			updateDatasetRun(current.id, { status: 'paused' });
		}
		throw error;
	}

	// Rebuild included/excluded from durable shard state so resume is authoritative.
	const includedHourOffsets: number[] = [];
	const excludedHourOffsets: number[] = [];
	for (const offset of requested) {
		const previousKey = hourKeyAtOffset(previous.windowStart, offset);
		const currentKey = hourKeyAtOffset(current.windowStart, offset);
		const prev = getDatasetShard(previous.id, previousKey, MATCHED_SAMPLE_FIRST_SHARD_KEY);
		const curr = getDatasetShard(current.id, currentKey, MATCHED_SAMPLE_FIRST_SHARD_KEY);
		if (prev?.status === 'completed' && curr?.status === 'completed') {
			includedHourOffsets.push(offset);
		} else {
			excludedHourOffsets.push(offset);
		}
	}

	const completedAt = new Date().toISOString();
	for (const run of [previous, current]) {
		updateDatasetRun(run.id, {
			status: 'complete',
			expectedShards: requested.length,
			completedShards: includedHourOffsets.length,
			partialShards: 0,
			failedShards: excludedHourOffsets.length,
			observedRepos: countObservedCandidates(run.id),
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
		excludedHourOffsets,
		hourResults
	};
}

function countObservedCandidates(runId: number): number {
	const rows = getDb()
		.prepare(
			`SELECT COALESCE(SUM(found), 0) AS c FROM backfill_dataset_shards
			 WHERE run_id = ? AND shard_key = ?`
		)
		.get(runId, MATCHED_SAMPLE_FIRST_SHARD_KEY) as { c: number };
	return rows.c;
}
