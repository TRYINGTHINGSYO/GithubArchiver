import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { insertRepo, saveEnrichment } from '$lib/server/db/repos';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/db/schema';
import {
	createMatchedDatasetPair,
	createPairedDatasetRuns,
	evaluateDatasetComparability,
	freezeMatchedDatasetPair,
	getDatasetEnrichmentProgress,
	listUnenrichedDatasetRepos,
	sampleDatasetFromExistingRepos,
	stableSampleRank
} from '$lib/server/dataset-runs';
import { runEmergingTopicDetection } from '$lib/server/emerging-topics';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('controlled dataset runs', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('applies schema version 24 with dataset run tables', () => {
		const db = getDb();
		const version = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number })
			.v;
		expect(version).toBe(CURRENT_SCHEMA_VERSION);
		expect(CURRENT_SCHEMA_VERSION).toBe(24);

		const tables = (
			db
				.prepare(
					`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?)`
				)
				.all(
					'backfill_dataset_runs',
					'backfill_dataset_repositories',
					'backfill_dataset_shards'
				) as { name: string }[]
		).map((row) => row.name);
		expect(tables).toContain('backfill_dataset_runs');
		expect(tables).toContain('backfill_dataset_repositories');
		expect(tables).toContain('backfill_dataset_shards');

		const cols = (
			db.prepare('PRAGMA table_info(emerging_detection_runs)').all() as { name: string }[]
		).map((col) => col.name);
		expect(cols).toContain('current_dataset_id');
		expect(cols).toContain('previous_dataset_id');
		const datasetCols = (
			db.prepare('PRAGMA table_info(backfill_dataset_runs)').all() as { name: string }[]
		).map((col) => col.name);
		expect(datasetCols).toContain('comparison_mode');
		expect(datasetCols).toContain('matched_hour_offsets_json');
		expect(datasetCols).toContain('paired_run_id');
		expect(datasetCols).toContain('construction_version');
		expect(datasetCols).toContain('candidate_pool_size');
	});

	it('produces a stable sample rank for the same identity', () => {
		const a = stableSampleRank(1, '2026-07-01-12', 'Acme/Widget');
		const b = stableSampleRank(1, '2026-07-01-12', 'acme/widget');
		const c = stableSampleRank(1, '2026-07-01-13', 'acme/widget');
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});

	it('fills toward targetSampleSize when hourly caps undershoot', () => {
		seedHourRepos('2026-06-29T10:00:00.000Z', 40, 'curr');
		seedHourRepos('2026-06-22T10:00:00.000Z', 40, 'prev');

		const pair = createPairedDatasetRuns({
			previousStart: '2026-06-22T00:00:00.000Z',
			previousEnd: '2026-06-29T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			currentEnd: '2026-07-06T00:00:00.000Z',
			maxPerHour: 5,
			targetSampleSize: 20
		});
		const current = sampleDatasetFromExistingRepos(pair.current.id);
		const previous = sampleDatasetFromExistingRepos(pair.previous.id);
		expect(current.sampledRepos).toBe(20);
		expect(previous.sampledRepos).toBe(20);

		const fillCount = (
			getDb()
				.prepare(
					`SELECT COUNT(*) AS c FROM backfill_dataset_repositories
					 WHERE run_id = ? AND inclusion_reason = 'deterministic-sample-fill'`
				)
				.get(pair.current.id) as { c: number }
		).c;
		expect(fillCount).toBeGreaterThan(0);
	});

	it('deterministically samples the same repos for identical plans', () => {
		seedHourRepos('2026-06-29T10:00:00.000Z', 20, 'curr');
		seedHourRepos('2026-06-22T10:00:00.000Z', 20, 'prev');

		const pairA = createPairedDatasetRuns({
			previousStart: '2026-06-22T00:00:00.000Z',
			previousEnd: '2026-06-29T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			currentEnd: '2026-07-06T00:00:00.000Z',
			maxPerHour: 5,
			targetSampleSize: 5
		});
		const sampledA = sampleDatasetFromExistingRepos(pairA.current.id);

		const pairB = createPairedDatasetRuns({
			previousStart: '2026-06-22T00:00:00.000Z',
			previousEnd: '2026-06-29T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			currentEnd: '2026-07-06T00:00:00.000Z',
			maxPerHour: 5,
			targetSampleSize: 5
		});
		const sampledB = sampleDatasetFromExistingRepos(pairB.current.id);

		expect(sampledA.sampledRepos).toBe(5);
		expect(sampledB.sampledRepos).toBe(5);

		const idsA = membershipIds(pairA.current.id);
		const idsB = membershipIds(pairB.current.id);
		expect(idsA).toEqual(idsB);
	});

	it('flags enrichment coverage imbalance between paired runs', () => {
		seedHourRepos('2026-06-29T10:00:00.000Z', 12, 'curr', { enrich: true });
		seedHourRepos('2026-06-22T10:00:00.000Z', 12, 'prev', { enrich: false });

		const pair = createPairedDatasetRuns({
			previousStart: '2026-06-22T00:00:00.000Z',
			previousEnd: '2026-06-29T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			currentEnd: '2026-07-06T00:00:00.000Z',
			maxPerHour: 9,
			comparisonMode: 'full-window'
		});
		const previous = sampleDatasetFromExistingRepos(pair.previous.id);
		const current = sampleDatasetFromExistingRepos(pair.current.id);
		const cmp = evaluateDatasetComparability(current, previous);
		expect(cmp.comparable).toBe(false);
		expect(cmp.growthSuppressedReason).toBe('enrichment-coverage-imbalance');
	});

	it('suppresses growth when a dataset is concentrated in too few hours', () => {
		seedHourRepos('2026-06-29T10:00:00.000Z', 15, 'curr', { enrich: true });
		seedHourRepos('2026-06-22T10:00:00.000Z', 15, 'prev', { enrich: true });

		const pair = createPairedDatasetRuns({
			previousStart: '2026-06-22T00:00:00.000Z',
			previousEnd: '2026-06-29T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			currentEnd: '2026-07-06T00:00:00.000Z',
			maxPerHour: 9,
			comparisonMode: 'full-window'
		});
		const previous = sampleDatasetFromExistingRepos(pair.previous.id);
		const current = sampleDatasetFromExistingRepos(pair.current.id);
		const cmp = evaluateDatasetComparability(current, previous);
		expect(cmp.temporalComparable).toBe(false);
		expect(cmp.growthSuppressedReason).toBe('insufficient-temporal-distribution');
		expect(cmp.currentTemporal.uniqueHoursRepresented).toBe(1);
	});

	it('treats well-distributed matched hours as comparable', () => {
		seedSpreadRepos('2026-06-29T00:00:00.000Z', 30, 5, 'curr');
		seedSpreadRepos('2026-06-22T00:00:00.000Z', 30, 5, 'prev');

		const pair = createPairedDatasetRuns({
			previousStart: '2026-06-22T00:00:00.000Z',
			previousEnd: '2026-06-29T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			currentEnd: '2026-07-06T00:00:00.000Z',
			maxPerHour: 9,
			comparisonMode: 'full-window'
		});
		const previous = sampleDatasetFromExistingRepos(pair.previous.id);
		const current = sampleDatasetFromExistingRepos(pair.current.id);
		const cmp = evaluateDatasetComparability(current, previous);
		expect(cmp.currentTemporal.uniqueHoursRepresented).toBeGreaterThanOrEqual(24);
		expect(cmp.matchedHourRatio).toBe(1);
		expect(cmp.temporalComparable).toBe(true);
		expect(cmp.comparable).toBe(true);
		expect(cmp.growthSuppressedReason).toBeNull();
	});

	it('lists un-enriched dataset members ordered by sample_rank without mutating membership', () => {
		seedSpreadRepos('2026-06-29T00:00:00.000Z', 4, 5, 'curr', { enrich: false });

		const pair = createPairedDatasetRuns({
			previousStart: '2026-06-22T00:00:00.000Z',
			previousEnd: '2026-06-29T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			currentEnd: '2026-07-06T00:00:00.000Z',
			maxPerHour: 9,
			comparisonMode: 'full-window'
		});
		const current = sampleDatasetFromExistingRepos(pair.current.id);
		expect(current.sampledRepos).toBe(20);

		const pending = listUnenrichedDatasetRepos(pair.current.id, 100);
		expect(pending.length).toBe(20);

		const ranks = getDb()
			.prepare(
				`SELECT sample_rank FROM backfill_dataset_repositories
				 WHERE run_id = ? ORDER BY sample_rank ASC LIMIT 3`
			)
			.all(pair.current.id) as { sample_rank: number }[];
		expect(ranks[0].sample_rank).toBeLessThanOrEqual(ranks[1].sample_rank);

		const before = getDatasetEnrichmentProgress(pair.current.id);
		expect(before.members).toBe(20);
		expect(before.enriched).toBe(0);
		expect(before.remaining).toBe(20);
	});

	it('freezes symmetric matched hours without cross-hour fill', () => {
		seedMatchedHours('2026-06-22T00:00:00.000Z', 'prev-match', 3);
		seedMatchedHours('2026-06-29T00:00:00.000Z', 'curr-match', 3, 162);

		const pair = createMatchedDatasetPair({
			previousStart: '2026-06-22T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			hoursPerDay: [0, 6, 12, 18],
			samplePerHour: 3
		});
		const frozen = freezeMatchedDatasetPair(pair.previous.id, pair.current.id);

		expect(frozen.requestedHourOffsets).toHaveLength(28);
		expect(frozen.includedHourOffsets).toHaveLength(27);
		expect(frozen.excludedHourOffsets).toEqual([162]);
		expect(frozen.previous.sampledRepos).toBe(81);
		expect(frozen.current.sampledRepos).toBe(81);
		expect(frozen.previous.comparisonMode).toBe('matched-hours');
		expect(frozen.previous.pairedRunId).toBe(frozen.current.id);
		expect(frozen.previous.matchedHourOffsets).toEqual(frozen.includedHourOffsets);
		expect(frozen.previous.partialShards).toBe(0);
		expect(frozen.previous.failedShards).toBe(0);
		expect(frozen.previous.expectedShards).toBe(28);
		expect(frozen.previous.completedShards).toBe(27);

		const fillCount = (
			getDb()
				.prepare(
					`SELECT COUNT(*) AS c FROM backfill_dataset_repositories
					 WHERE run_id IN (?, ?) AND inclusion_reason != 'matched-hour-sample'`
				)
				.get(frozen.previous.id, frozen.current.id) as { c: number }
		).c;
		expect(fillCount).toBe(0);

		const cmp = evaluateDatasetComparability(frozen.current, frozen.previous);
		expect(cmp.matchedHourCount).toBe(27);
		expect(cmp.completedMatchedHourRatio).toBeCloseTo(27 / 28);
		expect(cmp.maxPerHourSampleDifference).toBe(0);
		expect(cmp.comparable).toBe(true);

		const currentIds = membershipIds(frozen.current.id);
		const previousIds = membershipIds(frozen.previous.id);
		const setTopic = getDb().prepare(`UPDATE repos SET topics = '["matched-lift"]' WHERE id = ?`);
		for (const id of currentIds.slice(0, 27)) setTopic.run(id);
		for (const id of previousIds.slice(0, 25)) setTopic.run(id);
		const clearEnrichment = getDb().prepare(
			`UPDATE repos SET enriched_at = NULL, enrichment_level = 0 WHERE id = ?`
		);
		for (const id of previousIds.slice(-6)) clearEnrichment.run(id);

		const detection = runEmergingTopicDetection({
			currentDatasetId: frozen.current.id,
			previousDatasetId: frozen.previous.id
		});
		const candidate = detection.candidates.find((item) => item.key === 'matched-lift');
		expect(detection.comparability.comparisonLabel).toBe('Matched 27-hour comparison');
		expect(candidate?.growthPercent).toBe(8);
		expect(candidate?.prevalenceLiftPercent).toBe(0);
	});

	it('binds detection runs to dataset IDs and suppresses growth until comparable', () => {
		seedSpreadRepos('2026-06-29T00:00:00.000Z', 30, 5, 'curr', { topic: 'guard-topic-kit' });
		seedSpreadRepos('2026-06-22T00:00:00.000Z', 30, 5, 'prev', { topic: 'guard-topic-kit' });

		const pair = createPairedDatasetRuns({
			previousStart: '2026-06-22T00:00:00.000Z',
			previousEnd: '2026-06-29T00:00:00.000Z',
			currentStart: '2026-06-29T00:00:00.000Z',
			currentEnd: '2026-07-06T00:00:00.000Z',
			maxPerHour: 9,
			comparisonMode: 'full-window'
		});
		sampleDatasetFromExistingRepos(pair.previous.id);
		sampleDatasetFromExistingRepos(pair.current.id);

		const result = runEmergingTopicDetection({
			currentDatasetId: pair.current.id,
			previousDatasetId: pair.previous.id,
			periodEnd: new Date('2026-07-06T00:00:00.000Z'),
			windowDays: 7
		});

		expect(result.comparability.current.datasetId).toBe(pair.current.id);
		expect(result.comparability.previous.datasetId).toBe(pair.previous.id);

		const run = getDb()
			.prepare('SELECT current_dataset_id, previous_dataset_id, growth_suppressed_reason FROM emerging_detection_runs ORDER BY id DESC LIMIT 1')
			.get() as {
			current_dataset_id: number;
			previous_dataset_id: number;
			growth_suppressed_reason: string | null;
		};
		expect(run.current_dataset_id).toBe(pair.current.id);
		expect(run.previous_dataset_id).toBe(pair.previous.id);
		// Identical plans, full hour shard coverage, balanced samples → growth allowed.
		expect(run.growth_suppressed_reason).toBeNull();
		expect(result.comparability.comparable).toBe(true);
	});
});

function membershipIds(runId: number): number[] {
	return (
		getDb()
			.prepare(
				`SELECT repository_id FROM backfill_dataset_repositories
				 WHERE run_id = ? ORDER BY repository_id`
			)
			.all(runId) as { repository_id: number }[]
	).map((row) => row.repository_id);
}

function seedSpreadRepos(
	windowStartIso: string,
	hours: number,
	perHour: number,
	prefix: string,
	opts: { enrich?: boolean; topic?: string } = {}
): void {
	const startMs = Date.parse(windowStartIso);
	for (let h = 0; h < hours; h++) {
		const iso = new Date(startMs + h * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
		seedHourRepos(iso, perHour, `${prefix}-h${h}`, opts);
	}
}

function seedMatchedHours(
	windowStartIso: string,
	prefix: string,
	perHour: number,
	sparseOffset?: number
): void {
	const startMs = Date.parse(windowStartIso);
	const offsets = Array.from({ length: 7 }, (_, day) =>
		[0, 6, 12, 18].map((hour) => day * 24 + hour)
	).flat();
	for (const offset of offsets) {
		const count = offset === sparseOffset ? perHour - 1 : perHour;
		seedHourRepos(new Date(startMs + offset * 3_600_000).toISOString(), count, `${prefix}-${offset}`);
	}
}

function seedHourRepos(
	createdAt: string,
	count: number,
	prefix: string,
	opts: { enrich?: boolean; topic?: string } = {}
): void {
	const enrich = opts.enrich !== false;
	for (let i = 0; i < count; i++) {
		const owner = `${prefix}-owner-${i}`;
		const name = `${prefix}-repo-${i}`;
		const inserted = insertRepo({
			owner,
			name,
			full_name: `${owner}/${name}`,
			github_url: `https://github.com/${owner}/${name}`,
			event_id: `${owner}-${name}`,
			created_at: createdAt,
			first_seen_at: createdAt,
			discovery_source: 'github_search'
		});
		if (!inserted.id) throw new Error('insert failed');
		if (!enrich) continue;
		saveEnrichment(inserted.id, {
			default_branch: 'main',
			description: `Tooling for ${opts.topic ?? 'dataset'} workflows`,
			language: 'TypeScript',
			stars: 5,
			forks: 1,
			watchers: 5,
			license: 'MIT',
			topics: [opts.topic ?? 'dataset-sample'],
			pushed_at: createdAt,
			updated_at: createdAt
		});
		getDb()
			.prepare(
				`UPDATE repos SET category = 'ai-project', interesting_score = 60, signal_tier = 'normal'
				 WHERE id = ?`
			)
			.run(inserted.id);
	}
}
