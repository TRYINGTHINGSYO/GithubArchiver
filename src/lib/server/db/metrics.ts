import { getDb } from './connection.js';
import type { MetricSnapshotInput, MetricSnapshotRow } from './types.js';

export function insertMetricSnapshot(repoId: number, metrics: MetricSnapshotInput): number {
	const db = getDb();
	const capturedAt = new Date().toISOString();
	const result = db
		.prepare(
			`INSERT INTO repo_metrics_snapshots
			 (repo_id, stars, forks, watchers, open_issues, size, captured_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			repoId,
			metrics.stars,
			metrics.forks,
			metrics.watchers,
			metrics.open_issues,
			metrics.size,
			capturedAt
		);
	return Number(result.lastInsertRowid);
}

export function getLatestMetricSnapshot(repoId: number): MetricSnapshotRow | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT * FROM repo_metrics_snapshots
			 WHERE repo_id = ?
			 ORDER BY captured_at DESC
			 LIMIT 1`
		)
		.get(repoId) as MetricSnapshotRow | undefined;
	return row ?? null;
}

export function listMetricSnapshots(repoId: number, limit = 100): MetricSnapshotRow[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT * FROM repo_metrics_snapshots
			 WHERE repo_id = ?
			 ORDER BY captured_at DESC
			 LIMIT ?`
		)
		.all(repoId, limit) as MetricSnapshotRow[];
}

export function countMetricSnapshots(): number {
	const db = getDb();
	return (db.prepare('SELECT COUNT(*) as c FROM repo_metrics_snapshots').get() as { c: number }).c;
}

export function countReposWithMetrics(): number {
	const db = getDb();
	return (
		db
			.prepare('SELECT COUNT(DISTINCT repo_id) as c FROM repo_metrics_snapshots')
			.get() as { c: number }
	).c;
}
