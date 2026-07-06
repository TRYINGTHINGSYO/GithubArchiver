import { getDb } from './connection';

export function countReposEnriched(): number {
	const db = getDb();
	return (db.prepare('SELECT COUNT(*) as c FROM repos WHERE enriched_at IS NOT NULL').get() as { c: number }).c;
}

export function countReposArchived(): number {
	const db = getDb();
	return (
		db.prepare('SELECT COUNT(DISTINCT repo_id) as c FROM archive_snapshots').get() as { c: number }
	).c;
}

export function countReposWithReadme(): number {
	const db = getDb();
	return (
		db
			.prepare(
				`SELECT COUNT(DISTINCT repo_id) as c FROM archive_snapshots WHERE snapshot_type = 'readme'`
			)
			.get() as { c: number }
	).c;
}

export function countReposWithReleases(): number {
	const db = getDb();
	return (db.prepare('SELECT COUNT(DISTINCT repo_id) as c FROM releases').get() as { c: number }).c;
}

export function countReposByYear(): { year: string; count: number }[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT strftime('%Y', first_seen_at) as year, COUNT(*) as count
			 FROM repos GROUP BY year ORDER BY year DESC`
		)
		.all() as { year: string; count: number }[];
}

export function listLatestErrors(limit = 10): { source: string; message: string; at: string }[] {
	const db = getDb();
	const jobErrors = db
		.prepare(
			`SELECT job_type as source, COALESCE(error, 'failed') as message, started_at as at
			 FROM job_runs WHERE status = 'failed' AND error IS NOT NULL
			 ORDER BY started_at DESC LIMIT ?`
		)
		.all(limit) as { source: string; message: string; at: string }[];

	const backfillErrors = db
		.prepare(
			`SELECT 'backfill' as source, hour_key || ': ' || error as message, updated_at as at
			 FROM backfill_hours WHERE error IS NOT NULL
			 ORDER BY updated_at DESC LIMIT ?`
		)
		.all(limit) as { source: string; message: string; at: string }[];

	return [...jobErrors, ...backfillErrors]
		.sort((a, b) => b.at.localeCompare(a.at))
		.slice(0, limit);
}
