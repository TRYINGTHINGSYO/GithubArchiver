import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { startJobRun } from '$lib/server/db/jobs';
import {
	isSearchFallbackActive,
	reconcileOrphanedSearchIngestStats,
	startSearchIngestStat
} from '$lib/server/db/search-ingest';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('search fallback active flag', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('is false when nothing is running', () => {
		expect(isSearchFallbackActive()).toBe(false);
	});

	it('is true while a recent Search shard is running', () => {
		const nowMs = Date.parse('2026-07-18T00:00:00.000Z');
		const id = startSearchIngestStat({
			hourKey: '2026-07-16-22',
			query: 'created:2026-07-16T22:00:00Z..2026-07-16T23:00:00Z',
			shardDepth: 0,
			shardMinutes: null
		});
		getDb()
			.prepare(`UPDATE search_ingest_stats SET started_at = ? WHERE id = ?`)
			.run(new Date(nowMs - 2 * 60 * 1000).toISOString(), id);

		expect(isSearchFallbackActive(nowMs)).toBe(true);
	});

	it('is false for stale running Search shards left by restarts', () => {
		const nowMs = Date.parse('2026-07-18T00:00:00.000Z');
		const id = startSearchIngestStat({
			hourKey: '2026-07-16-22',
			query: 'created:2026-07-16T22:00:00Z..2026-07-16T23:00:00Z',
			shardDepth: 0,
			shardMinutes: null
		});
		getDb()
			.prepare(`UPDATE search_ingest_stats SET started_at = ? WHERE id = ?`)
			.run(new Date(nowMs - 20 * 60 * 1000).toISOString(), id);

		expect(isSearchFallbackActive(nowMs)).toBe(false);
	});

	it('is true while a recent search_gap ingest job is running', () => {
		const nowMs = Date.parse('2026-07-18T00:00:00.000Z');
		const jobId = startJobRun('ingest', { action: 'search_gap', hour_key: '2026-07-16-22' });
		getDb()
			.prepare(`UPDATE job_runs SET started_at = ? WHERE id = ?`)
			.run(new Date(nowMs - 3 * 60 * 1000).toISOString(), jobId);

		expect(isSearchFallbackActive(nowMs)).toBe(true);
	});

	it('is false for ordinary running ingest jobs', () => {
		const nowMs = Date.parse('2026-07-18T00:00:00.000Z');
		const jobId = startJobRun('ingest', { action: 'ingest', hour_key: '2026-07-16-23' });
		getDb()
			.prepare(`UPDATE job_runs SET started_at = ? WHERE id = ?`)
			.run(new Date(nowMs - 1 * 60 * 1000).toISOString(), jobId);

		expect(isSearchFallbackActive(nowMs)).toBe(false);
	});

	it('reconciles orphaned Search shards on startup', () => {
		const nowMs = Date.parse('2026-07-18T00:00:00.000Z');
		const staleId = startSearchIngestStat({
			hourKey: '2026-07-16-21',
			query: 'created:…',
			shardDepth: 0,
			shardMinutes: null
		});
		const freshId = startSearchIngestStat({
			hourKey: '2026-07-16-22',
			query: 'created:…',
			shardDepth: 0,
			shardMinutes: null
		});
		const db = getDb();
		db.prepare(`UPDATE search_ingest_stats SET started_at = ? WHERE id = ?`).run(
			new Date(nowMs - 20 * 60 * 1000).toISOString(),
			staleId
		);
		db.prepare(`UPDATE search_ingest_stats SET started_at = ? WHERE id = ?`).run(
			new Date(nowMs - 2 * 60 * 1000).toISOString(),
			freshId
		);

		expect(reconcileOrphanedSearchIngestStats(10 * 60 * 1000, nowMs)).toBe(1);

		const stale = db
			.prepare('SELECT status, error FROM search_ingest_stats WHERE id = ?')
			.get(staleId) as { status: string; error: string };
		expect(stale.status).toBe('failed');
		expect(stale.error).toContain('orphaned');

		const fresh = db
			.prepare('SELECT status FROM search_ingest_stats WHERE id = ?')
			.get(freshId) as { status: string };
		expect(fresh.status).toBe('running');
	});
});
