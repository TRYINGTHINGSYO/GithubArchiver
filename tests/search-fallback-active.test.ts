import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ensureBackgroundWorker,
	resetBackgroundDaemonForTests
} from '$lib/server/background-daemon';
import { getDb } from '$lib/server/db/connection';
import { startJobRun } from '$lib/server/db/jobs';
import {
	isSearchFallbackActive,
	reconcileOrphanedSearchIngestStats,
	startSearchIngestStat
} from '$lib/server/db/search-ingest';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('search fallback active flag', () => {
	const envKeys = [
		'BACKGROUND_WORKER',
		'RAILWAY_ENVIRONMENT',
		'RAILWAY_PROJECT_ID'
	] as const;
	const previousEnv = new Map<string, string | undefined>();

	beforeEach(() => {
		setupTestDb();
		resetBackgroundDaemonForTests();
		for (const key of envKeys) {
			previousEnv.set(key, process.env[key]);
		}
		// Exercise startup reconcile without launching the daemon loop.
		process.env.BACKGROUND_WORKER = '0';
		delete process.env.RAILWAY_ENVIRONMENT;
		delete process.env.RAILWAY_PROJECT_ID;
	});
	afterEach(() => {
		resetBackgroundDaemonForTests();
		for (const key of envKeys) {
			const value = previousEnv.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		teardownTestDb();
	});

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

	it('daemon startup reconciles stale Search rows then detects live ones', () => {
		const nowMs = Date.now();
		const staleId = startSearchIngestStat({
			hourKey: '2026-07-16-21',
			query: 'created:stale',
			shardDepth: 0,
			shardMinutes: null
		});
		const db = getDb();
		db.prepare(`UPDATE search_ingest_stats SET started_at = ? WHERE id = ?`).run(
			new Date(nowMs - 20 * 60 * 1000).toISOString(),
			staleId
		);

		// Precondition: stale running row would have lied before the age floor.
		expect(
			db.prepare(`SELECT status FROM search_ingest_stats WHERE id = ?`).get(staleId)
		).toEqual({ status: 'running' });

		ensureBackgroundWorker();

		const reconciled = db
			.prepare('SELECT status, error FROM search_ingest_stats WHERE id = ?')
			.get(staleId) as { status: string; error: string };
		expect(reconciled.status).toBe('failed');
		expect(reconciled.error).toContain('orphaned');
		expect(isSearchFallbackActive()).toBe(false);

		startSearchIngestStat({
			hourKey: '2026-07-16-22',
			query: 'created:live',
			shardDepth: 0,
			shardMinutes: null
		});
		expect(isSearchFallbackActive()).toBe(true);
	});
});
