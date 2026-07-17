import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import {
	createMatchedDatasetPair,
	evaluateDatasetComparability,
	stableSampleRank
} from '$lib/server/dataset-runs';
import {
	buildMatchedPairSampleFirst,
	collectHourCandidatePool,
	matchedMinuteShardOrder,
	selectSampleFromPool,
	type MatchedSearchFn
} from '$lib/server/matched-sample-first';
import type { GitHubSearchRepoResponse } from '$lib/server/github';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('sample-first matched construction', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('uses a fixed 60-minute shard order', () => {
		expect(matchedMinuteShardOrder()).toEqual(Array.from({ length: 60 }, (_, i) => i));
	});

	it('stops collecting once the candidate pool is full and does not require every minute', async () => {
		let pages = 0;
		const searchFn: MatchedSearchFn = async (_query, page) => {
			pages += 1;
			const items = Array.from({ length: 100 }, (_, i) =>
				fakeItem(`owner-${page}-${i}`, `repo-${page}-${i}`, '2026-06-22T00:00:10.000Z')
			);
			return { total_count: 5000, incomplete_results: false, items };
		};

		const pool = await collectHourCandidatePool({
			hourKey: '2026-06-22-00',
			candidatePoolSize: 100,
			searchFn
		});

		expect(pool.candidates).toHaveLength(100);
		expect(pool.poolFull).toBe(true);
		expect(pool.shardsQueried).toBe(1);
		expect(pages).toBe(1);
	});

	it('selects only the top sample by stable rank from the pool', () => {
		const pool = {
			hourKey: '2026-06-22-00',
			candidates: Array.from({ length: 40 }, (_, i) => ({
				fullName: `owner/repo-${i}`,
				owner: 'owner',
				name: `repo-${i}`,
				githubUrl: `https://github.com/owner/repo-${i}`,
				githubId: i + 1,
				createdAt: '2026-06-22T00:00:00.000Z'
			})),
			shardsQueried: 1,
			pagesFetched: 1,
			incomplete: false,
			poolFull: true
		};
		const selected = selectSampleFromPool(pool, 2, 5);
		expect(selected).toHaveLength(5);
		const ranks = selected.map((row) => row.sampleRank);
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
		expect(selected[0].sampleRank).toBe(
			stableSampleRank(2, '2026-06-22-00', selected[0].fullName)
		);
	});

	it('produces identical membership for identical search responses', async () => {
		const searchFn = scriptedSearch(28, 120);
		const pairA = createMatchedDatasetPair({
			previousStart: '2026-06-22T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			hoursPerDay: [0, 6, 12, 18],
			samplePerHour: 3,
			candidatePoolSize: 10
		});
		const builtA = await buildMatchedPairSampleFirst({
			previousRunId: pairA.previous.id,
			currentRunId: pairA.current.id,
			concurrency: 1,
			searchDelayMs: 0,
			searchFn
		});

		const pairB = createMatchedDatasetPair({
			previousStart: '2026-06-22T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			hoursPerDay: [0, 6, 12, 18],
			samplePerHour: 3,
			candidatePoolSize: 10
		});
		const builtB = await buildMatchedPairSampleFirst({
			previousRunId: pairB.previous.id,
			currentRunId: pairB.current.id,
			concurrency: 1,
			searchDelayMs: 0,
			searchFn
		});

		expect(membershipNames(builtA.previous.id)).toEqual(membershipNames(builtB.previous.id));
		expect(membershipNames(builtA.current.id)).toEqual(membershipNames(builtB.current.id));
		expect(builtA.includedHourOffsets).toEqual(builtB.includedHourOffsets);
	});

	it('does not change membership when concurrency varies', async () => {
		const searchFn = scriptedSearch(28, 80);
		const pairA = createMatchedDatasetPair({
			previousStart: '2026-06-22T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			hoursPerDay: [0, 6],
			samplePerHour: 4,
			candidatePoolSize: 12
		});
		const builtA = await buildMatchedPairSampleFirst({
			previousRunId: pairA.previous.id,
			currentRunId: pairA.current.id,
			concurrency: 1,
			searchDelayMs: 0,
			searchFn
		});

		const pairB = createMatchedDatasetPair({
			previousStart: '2026-06-22T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			hoursPerDay: [0, 6],
			samplePerHour: 4,
			candidatePoolSize: 12
		});
		const builtB = await buildMatchedPairSampleFirst({
			previousRunId: pairB.previous.id,
			currentRunId: pairB.current.id,
			concurrency: 4,
			searchDelayMs: 0,
			searchFn
		});

		expect(membershipNames(builtA.previous.id)).toEqual(membershipNames(builtB.previous.id));
		expect(membershipNames(builtA.current.id)).toEqual(membershipNames(builtB.current.id));
	});

	it('persists only selected repositories into dataset membership', async () => {
		const searchFn = scriptedSearch(4, 50);
		const pair = createMatchedDatasetPair({
			previousStart: '2026-06-22T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			hoursPerDay: [0],
			samplePerHour: 5,
			candidatePoolSize: 20
		});
		// Restrict to a single matched offset for a tight membership assertion.
		restrictToOffsets(pair.previous.id, pair.current.id, [0]);
		const built = await buildMatchedPairSampleFirst({
			previousRunId: pair.previous.id,
			currentRunId: pair.current.id,
			concurrency: 1,
			searchDelayMs: 0,
			searchFn
		});

		expect(built.previous.sampledRepos).toBe(5);
		expect(built.current.sampledRepos).toBe(5);

		const reasons = getDb()
			.prepare(
				`SELECT DISTINCT inclusion_reason AS reason FROM backfill_dataset_repositories
				 WHERE run_id IN (?, ?)`
			)
			.all(built.previous.id, built.current.id) as { reason: string }[];
		expect(reasons.map((row) => row.reason)).toEqual(['matched-hour-sample-first']);
	});

	it('resumes without changing completed hours', async () => {
		let calls = 0;
		const searchFn: MatchedSearchFn = async (query) => {
			calls += 1;
			const day = query.includes('2026-06-22') ? 'prev' : 'curr';
			const hour = query.match(/T(\d{2}):/)?.[1] ?? '00';
			const items = Array.from({ length: 30 }, (_, i) =>
				fakeItem(`${day}-${hour}-o${i}`, `r${i}`, `2026-06-${day === 'prev' ? '22' : '29'}T${hour}:00:10.000Z`)
			);
			return { total_count: 30, incomplete_results: false, items };
		};

		const pair = createMatchedDatasetPair({
			previousStart: '2026-06-22T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			hoursPerDay: [0, 6],
			samplePerHour: 5,
			candidatePoolSize: 20
		});
		restrictToOffsets(pair.previous.id, pair.current.id, [0, 6]);

		const first = await buildMatchedPairSampleFirst({
			previousRunId: pair.previous.id,
			currentRunId: pair.current.id,
			concurrency: 1,
			searchDelayMs: 0,
			searchFn
		});
		const namesAfterFirst = membershipNames(first.previous.id);
		const callsAfterFirst = calls;

		const second = await buildMatchedPairSampleFirst({
			previousRunId: pair.previous.id,
			currentRunId: pair.current.id,
			concurrency: 1,
			searchDelayMs: 0,
			searchFn
		});

		expect(calls).toBe(callsAfterFirst);
		expect(membershipNames(second.previous.id)).toEqual(namesAfterFirst);
		expect(second.includedHourOffsets).toEqual(first.includedHourOffsets);
	});

	it('excludes incomplete matched hours symmetrically', async () => {
		const searchFn: MatchedSearchFn = async (query) => {
			const incomplete = query.includes('2026-06-22');
			const items = Array.from({ length: 40 }, (_, i) =>
				fakeItem(`side-${i}`, `repo-${i}`, '2026-06-22T00:00:10.000Z')
			);
			return { total_count: 40, incomplete_results: incomplete, items };
		};

		const pair = createMatchedDatasetPair({
			previousStart: '2026-06-22T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			hoursPerDay: [0],
			samplePerHour: 5,
			candidatePoolSize: 20
		});
		restrictToOffsets(pair.previous.id, pair.current.id, [0]);
		const built = await buildMatchedPairSampleFirst({
			previousRunId: pair.previous.id,
			currentRunId: pair.current.id,
			concurrency: 1,
			searchDelayMs: 0,
			searchFn
		});

		expect(built.includedHourOffsets).toEqual([]);
		expect(built.excludedHourOffsets).toEqual([0]);
		expect(built.previous.sampledRepos).toBe(0);
		expect(built.current.sampledRepos).toBe(0);
	});

	it('rejects mismatched candidate-pool plans in comparability', () => {
		const previous = createMatchedDatasetPair({
			previousStart: '2026-06-22T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			samplePerHour: 5,
			candidatePoolSize: 20
		}).previous;
		const current = createMatchedDatasetPair({
			previousStart: '2026-06-22T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			samplePerHour: 5,
			candidatePoolSize: 40
		}).current;

		const cmp = evaluateDatasetComparability(current, previous);
		expect(cmp.comparable).toBe(false);
		expect(cmp.growthSuppressedReason).toBe('different-sampling-plans');
	});
});

function restrictToOffsets(previousId: number, currentId: number, offsets: number[]) {
	const json = JSON.stringify(offsets);
	getDb()
		.prepare(
			`UPDATE backfill_dataset_runs
			 SET matched_hour_offsets_json = ?, expected_shards = ?, target_sample_size = max_per_hour * ?
			 WHERE id IN (?, ?)`
		)
		.run(json, offsets.length, offsets.length, previousId, currentId);
}

function fakeItem(owner: string, name: string, createdAt: string) {
	return {
		id: Math.abs(
			Array.from(`${owner}/${name}`).reduce((sum, ch) => sum + ch.charCodeAt(0) * 31, 0)
		),
		name,
		full_name: `${owner}/${name}`,
		owner: { login: owner },
		html_url: `https://github.com/${owner}/${name}`,
		created_at: createdAt
	};
}

function scriptedSearch(offsetsNeeded: number, perHour: number): MatchedSearchFn {
	void offsetsNeeded;
	return async (query) => {
		const match = query.match(/created:(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
		const day = match?.[1] ?? '2026-06-22';
		const hour = match?.[2] ?? '00';
		const minute = match?.[3] ?? '00';
		// Only the first minute of each hour returns candidates so the pool fills quickly.
		if (minute !== '00') {
			return { total_count: 0, incomplete_results: false, items: [] };
		}
		const items = Array.from({ length: perHour }, (_, i) =>
			fakeItem(`${day}-${hour}-o${i}`, `repo-${i}`, `${day}T${hour}:00:10.000Z`)
		);
		return { total_count: perHour, incomplete_results: false, items } satisfies GitHubSearchRepoResponse;
	};
}

function membershipNames(runId: number): string[] {
	return (
		getDb()
			.prepare(
				`SELECT r.full_name AS full_name
				 FROM backfill_dataset_repositories d
				 JOIN repos r ON r.id = d.repository_id
				 WHERE d.run_id = ?
				 ORDER BY d.time_bucket, d.sample_rank, r.full_name`
			)
			.all(runId) as { full_name: string }[]
	).map((row) => row.full_name);
}
