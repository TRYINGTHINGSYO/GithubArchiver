import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { insertRepo, saveEnrichment } from '$lib/server/db/repos';
import type { DiscoverySource } from '$lib/server/db/types';
import {
	detectEmergingTopics,
	evaluateWindowComparability,
	getDetectionComparability,
	getDetectionWindowMetadata,
	runEmergingTopicDetection
} from '$lib/server/emerging-topics';
import { setupTestDb, teardownTestDb } from './helpers/db';

const PERIOD_END = new Date('2026-07-15T00:00:00.000Z');
const CURRENT_CREATED = '2026-07-10T12:00:00.000Z';
const PREVIOUS_CREATED = '2026-07-03T12:00:00.000Z';

describe('detection window comparability guard', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('computes window provenance metadata', () => {
		seedTopicRepos('guard-topic-kit', { current: 12, previous: 6, owners: 8 });

		const meta = getDetectionWindowMetadata('2026-07-08T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
		expect(meta.totalObservedRepos).toBe(12);
		expect(meta.enrichedRepos).toBe(12);
		expect(meta.enrichedCoverage).toBe(1);
		expect(meta.ingestionSource).toBe('gharchive');
		expect(meta.hoursExpected).toBe(168);
		expect(meta.hoursProcessed).toBe(0);
	});

	it('suppresses growth when hour coverage is insufficient', () => {
		seedTopicRepos('guard-topic-kit', { current: 12, previous: 6, owners: 8 });

		const comparability = getDetectionComparability({ periodEnd: PERIOD_END, windowDays: 7 });
		expect(comparability.comparable).toBe(false);
		expect(comparability.growthSuppressedReason).toBe('insufficient-hour-coverage');

		const candidates = detectEmergingTopics({ periodEnd: PERIOD_END, windowDays: 7 });
		const candidate = candidates.find((row) => row.key === 'guard-topic-kit');
		expect(candidate).toBeDefined();
		expect(candidate?.growthPercent).toBeNull();
		expect(candidate?.momentumScore).toBeNull();
		expect(candidate?.growthSuppressedReason).toBe('insufficient-hour-coverage');
		expect(candidate?.evidence.scoreBreakdown.momentum).toBeNull();
	});

	it('keeps growth active when both windows share a source with full hour coverage', () => {
		seedTopicRepos('guard-topic-kit', { current: 12, previous: 6, owners: 8 });
		fillIngestionHours('2026-07-01T00:00:00.000Z', '2026-07-15T00:00:00.000Z');

		const comparability = getDetectionComparability({ periodEnd: PERIOD_END, windowDays: 7 });
		expect(comparability.comparable).toBe(true);
		expect(comparability.growthSuppressedReason).toBeNull();

		const candidates = detectEmergingTopics({ periodEnd: PERIOD_END, windowDays: 7 });
		const candidate = candidates.find((row) => row.key === 'guard-topic-kit');
		expect(candidate).toBeDefined();
		expect(candidate?.momentumScore).not.toBeNull();
		expect(candidate?.growthPercent).toBe(100);
		expect(candidate?.growthSuppressedReason).toBeNull();
	});

	it('suppresses growth when the windows use different ingestion sources', () => {
		seedTopicRepos('guard-topic-kit', {
			current: 12,
			previous: 6,
			owners: 8,
			currentSource: 'github_search',
			previousSource: 'gharchive'
		});
		fillIngestionHours('2026-07-01T00:00:00.000Z', '2026-07-15T00:00:00.000Z');

		const comparability = getDetectionComparability({ periodEnd: PERIOD_END, windowDays: 7 });
		expect(comparability.comparable).toBe(false);
		expect(comparability.growthSuppressedReason).toBe('incomparable-ingestion-sources');
		expect(comparability.current.ingestionSource).toBe('github-search');
		expect(comparability.previous.ingestionSource).toBe('gharchive');
	});

	it('flags mixed-source windows as incomparable', () => {
		const meta = {
			windowStart: '2026-07-08T00:00:00.000Z',
			windowEnd: '2026-07-15T00:00:00.000Z',
			ingestionSource: 'mixed' as const,
			totalObservedRepos: 100,
			enrichedRepos: 80,
			enrichedCoverage: 0.8,
			hoursExpected: 168,
			hoursProcessed: 168,
			deduplicationVersion: 1
		};
		const other = { ...meta, ingestionSource: 'gharchive' as const };
		const result = evaluateWindowComparability(meta, other);
		expect(result.comparable).toBe(false);
		expect(result.growthSuppressedReason).toBe('incomparable-ingestion-sources');
	});

	it('records window provenance with each detection run', () => {
		seedTopicRepos('guard-topic-kit', { current: 12, previous: 6, owners: 8 });

		const result = runEmergingTopicDetection({ periodEnd: PERIOD_END, windowDays: 7 });
		expect(result.comparability.growthSuppressedReason).toBe('insufficient-hour-coverage');

		const run = getDb()
			.prepare('SELECT * FROM emerging_detection_runs ORDER BY id DESC LIMIT 1')
			.get() as {
			growth_suppressed_reason: string | null;
			current_window_json: string;
			previous_window_json: string;
			candidates_detected: number;
		};
		expect(run.growth_suppressed_reason).toBe('insufficient-hour-coverage');
		const currentWindow = JSON.parse(run.current_window_json) as { totalObservedRepos: number };
		expect(currentWindow.totalObservedRepos).toBe(12);
	});
});

function fillIngestionHours(startIso: string, endIso: string): void {
	const db = getDb();
	const insert = db.prepare(
		`INSERT OR IGNORE INTO ingestion_state (hour_key, ingested_at, events, inserted, skipped, source)
		 VALUES (?, ?, 100, 10, 0, 'gharchive')`
	);
	const now = new Date().toISOString();
	for (let t = Date.parse(startIso); t < Date.parse(endIso); t += 3_600_000) {
		const d = new Date(t);
		const key = `${d.toISOString().slice(0, 10)}-${String(d.getUTCHours()).padStart(2, '0')}`;
		insert.run(key, now);
	}
}

function seedTopicRepos(
	topic: string,
	opts: {
		current: number;
		previous: number;
		owners: number;
		currentSource?: DiscoverySource;
		previousSource?: DiscoverySource;
	}
): void {
	for (let i = 0; i < opts.previous; i++) {
		insertSeedRepo({
			owner: `prev-owner-${i % Math.max(1, opts.owners)}`,
			name: `${topic}-prev-${i}`,
			topic,
			createdAt: PREVIOUS_CREATED,
			source: opts.previousSource ?? 'gharchive'
		});
	}
	for (let i = 0; i < opts.current; i++) {
		insertSeedRepo({
			owner: `owner-${i % Math.max(1, opts.owners)}`,
			name: `${topic}-${i}`,
			topic,
			createdAt: CURRENT_CREATED,
			source: opts.currentSource ?? 'gharchive'
		});
	}
}

function insertSeedRepo(opts: {
	owner: string;
	name: string;
	topic: string;
	createdAt: string;
	source: DiscoverySource;
}): void {
	const inserted = insertRepo({
		owner: opts.owner,
		name: opts.name,
		full_name: `${opts.owner}/${opts.name}`,
		github_url: `https://github.com/${opts.owner}/${opts.name}`,
		event_id: `${opts.owner}-${opts.name}`,
		created_at: opts.createdAt,
		first_seen_at: opts.createdAt,
		discovery_source: opts.source
	});
	if (!inserted.id) throw new Error('failed to insert repo');
	saveEnrichment(inserted.id, {
		default_branch: 'main',
		description: `Tooling for ${opts.topic} workflows`,
		language: 'TypeScript',
		stars: 10,
		forks: 2,
		watchers: 10,
		license: 'MIT',
		topics: [opts.topic],
		pushed_at: opts.createdAt,
		updated_at: opts.createdAt
	});
	getDb()
		.prepare(
			`UPDATE repos SET category = 'ai-project', interesting_score = 65, signal_tier = 'normal'
			 WHERE id = ?`
		)
		.run(inserted.id);
}
