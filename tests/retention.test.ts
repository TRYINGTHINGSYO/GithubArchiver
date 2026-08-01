import { mkdirSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { insertMetricSnapshot } from '$lib/server/db/metrics';
import { getDatabaseInventory } from '$lib/server/db-inventory';
import {
	pruneBackups,
	pruneJobRuns,
	pruneMetricSnapshots,
	pruneRepositoryEvents,
	runRetention,
	selectBackupsToDelete
} from '$lib/server/retention';
import { getStorageReport } from '$lib/server/storage';
import { createTestRepo, setupTestDb, teardownTestDb } from './helpers/db';

describe('storage retention', () => {
	beforeEach(() => {
		setupTestDb();
		process.env.JOB_RUNS_RETENTION_DAYS = '30';
		process.env.JOB_RUNS_FAILED_RETENTION_DAYS = '90';
		process.env.EVENT_RETENTION_DAYS = '90';
		process.env.METRICS_RETENTION_DAYS = '30';
		process.env.BACKUP_KEEP_DAILY = '2';
		process.env.BACKUP_KEEP_WEEKLY = '1';
		process.env.BACKUP_KEEP_MONTHLY = '1';
	});

	afterEach(() => {
		teardownTestDb();
		delete process.env.JOB_RUNS_RETENTION_DAYS;
		delete process.env.JOB_RUNS_FAILED_RETENTION_DAYS;
		delete process.env.EVENT_RETENTION_DAYS;
		delete process.env.METRICS_RETENTION_DAYS;
		delete process.env.BACKUP_KEEP_DAILY;
		delete process.env.BACKUP_KEEP_WEEKLY;
		delete process.env.BACKUP_KEEP_MONTHLY;
		delete process.env.BACKUPS_DIR;
	});

	it('reports database inventory with row counts and github_id uniqueness', () => {
		const a = createTestRepo();
		const db = getDb();
		db.prepare('UPDATE repos SET github_id = ? WHERE id = ?').run(42, a.id);
		const inventory = getDatabaseInventory();
		expect(inventory.row_counts.some((row) => row.name === 'repos' && row.count >= 1)).toBe(true);
		expect(inventory.duplicate_github_ids).toEqual([]);
		expect(inventory.metadata_only).toBe(true);

		const report = getStorageReport();
		expect(report.database.database_path).toContain('test.db');
		expect(report.retention).toBeDefined();
		expect(report.retention!.actions.length).toBeGreaterThan(0);
	});

	it('stores github_id uniquely and rejects a second insert of the same id', () => {
		const db = getDb();
		const repo = createTestRepo();
		db.prepare('UPDATE repos SET github_id = ? WHERE id = ?').run(99, repo.id);
		const other = createTestRepo();
		expect(() =>
			db.prepare('UPDATE repos SET github_id = ? WHERE id = ?').run(99, other.id)
		).toThrow();
	});

	it('prunes aged successful job_runs but keeps recent and running rows', () => {
		const db = getDb();
		db.prepare(
			`INSERT INTO job_runs (job_type, status, started_at, finished_at, detail_json)
			 VALUES ('ingest', 'success', ?, ?, '{}')`
		).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:05:00.000Z');
		db.prepare(
			`INSERT INTO job_runs (job_type, status, started_at, finished_at, detail_json)
			 VALUES ('ingest', 'failed', ?, ?, '{}')`
		).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:05:00.000Z');
		db.prepare(
			`INSERT INTO job_runs (job_type, status, started_at, detail_json)
			 VALUES ('ingest', 'running', ?, '{}')`
		).run(new Date().toISOString());
		db.prepare(
			`INSERT INTO job_runs (job_type, status, started_at, finished_at, detail_json)
			 VALUES ('enrich', 'success', ?, ?, '{}')`
		).run(new Date().toISOString(), new Date().toISOString());

		const preview = pruneJobRuns(false);
		expect(preview.deleted).toBe(2);
		expect(preview.applied).toBe(false);

		const applied = pruneJobRuns(true);
		expect(applied.deleted).toBe(2);
		expect(applied.applied).toBe(true);

		const remaining = db.prepare('SELECT status FROM job_runs ORDER BY id').all() as Array<{
			status: string;
		}>;
		expect(remaining.map((row) => row.status).sort()).toEqual(['running', 'success']);
	});

	it('collapses same-day metric snapshots and ages older ones', () => {
		const repo = createTestRepo();
		const db = getDb();
		db.prepare(
			`INSERT INTO repo_metrics_snapshots
			 (repo_id, stars, forks, watchers, open_issues, size, captured_at)
			 VALUES (?, 1, 0, 0, 0, 0, ?)`
		).run(repo.id, '2026-01-01T01:00:00.000Z');
		db.prepare(
			`INSERT INTO repo_metrics_snapshots
			 (repo_id, stars, forks, watchers, open_issues, size, captured_at)
			 VALUES (?, 2, 0, 0, 0, 0, ?)`
		).run(repo.id, '2026-01-01T08:00:00.000Z');
		insertMetricSnapshot(repo.id, {
			stars: 3,
			forks: 0,
			watchers: 0,
			open_issues: 0,
			size: 0
		});

		const result = pruneMetricSnapshots(true);
		expect(result.deleted).toBeGreaterThanOrEqual(1);

		const rows = db
			.prepare(
				`SELECT stars, captured_at FROM repo_metrics_snapshots
				 WHERE repo_id = ? ORDER BY captured_at`
			)
			.all(repo.id) as Array<{ stars: number; captured_at: string }>;
		expect(rows.length).toBeLessThanOrEqual(2);
		expect(rows.some((row) => row.stars === 3)).toBe(true);
	});

	it('prunes high-churn events while keeping first_seen', () => {
		const repo = createTestRepo();
		const db = getDb();
		db.prepare(
			`INSERT INTO repository_events (repo_id, event_type, event_time, payload_json)
			 VALUES (?, 'metadata_updated', ?, '{}')`
		).run(repo.id, '2025-01-01T00:00:00.000Z');
		db.prepare(
			`INSERT INTO repository_events (repo_id, event_type, event_time, payload_json)
			 VALUES (?, 'first_seen', ?, '{}')`
		).run(repo.id, '2025-01-01T00:00:00.000Z');

		const result = pruneRepositoryEvents(true);
		expect(result.deleted).toBe(1);
		const types = db
			.prepare(`SELECT event_type FROM repository_events WHERE repo_id = ?`)
			.all(repo.id) as Array<{ event_type: string }>;
		expect(types.map((row) => row.event_type)).toContain('first_seen');
		expect(types.map((row) => row.event_type)).not.toContain('metadata_updated');
	});

	it('selects excess backups beyond daily/weekly/monthly keep counts', () => {
		const day = 24 * 60 * 60 * 1000;
		const entries = [
			{ dirName: 'newest', mtime: Date.now(), paths: [], bytes: 1 },
			{ dirName: 'day-1', mtime: Date.now() - day, paths: [], bytes: 1 },
			{ dirName: 'day-2', mtime: Date.now() - 2 * day, paths: [], bytes: 1 },
			{ dirName: 'day-3', mtime: Date.now() - 3 * day, paths: [], bytes: 1 },
			{ dirName: 'old-month', mtime: Date.now() - 40 * day, paths: [], bytes: 1 }
		];
		const doomed = selectBackupsToDelete(entries);
		expect(doomed.map((entry) => entry.dirName)).toContain('day-3');
	});

	it('deletes pruned backup directories from disk', () => {
		const root = join(process.env.DATABASE_PATH!, '..', 'backups');
		process.env.BACKUPS_DIR = root;
		mkdirSync(root, { recursive: true });

		const names = ['2026-07-01_00-00-00', '2026-07-02_00-00-00', '2026-07-03_00-00-00', '2026-07-04_00-00-00'];
		const now = Date.now();
		names.forEach((name, index) => {
			const dir = join(root, name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ backup_created_at: name }));
			const mtime = new Date(now - index * 24 * 60 * 60 * 1000);
			utimesSync(dir, mtime, mtime);
		});

		const result = pruneBackups(true);
		expect(result.deleted).toBeGreaterThan(0);
		const remaining = names.filter((name) => existsSync(join(root, name)));
		expect(remaining.length).toBeLessThan(names.length);
		expect(remaining).toContain('2026-07-01_00-00-00');
	});

	it('applies a full retention pass without vacuum by default', () => {
		const report = runRetention({
			apply: true,
			vacuum: false,
			jobRuns: true,
			metrics: true,
			events: true,
			backups: true
		});
		expect(report.vacuumed).toBe(false);
		expect(report.actions.map((action) => action.id)).toEqual(
			expect.arrayContaining(['prune_job_runs', 'prune_metrics', 'prune_events', 'prune_backups'])
		);
	});
});
