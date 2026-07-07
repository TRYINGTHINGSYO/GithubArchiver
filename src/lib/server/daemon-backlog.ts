/**
 * Assembles BacklogSnapshot from SQLite for daemon-planner.ts.
 */

import { getActiveBackfillJob, getBackfillProgress } from '$lib/server/db/backfill';
import { getDb } from '$lib/server/db/connection';
import { listMissingHourKeys } from '$lib/server/db/ingestion';
import { countReposDueForRefresh, countUnenriched } from '$lib/server/db/repos';
import { defaultHourKey } from '$lib/server/gharchive';
import type { BacklogSnapshot } from '$lib/server/daemon-planner';

export function countUnarchivedSourceSnapshots(): number {
	const db = getDb();
	return (
		db
			.prepare(
				`SELECT COUNT(*) as c FROM repos r
				 WHERE r.enriched_at IS NOT NULL
				   AND r.deleted_at IS NULL
				   AND NOT EXISTS (
				     SELECT 1 FROM archive_snapshots a
				     WHERE a.repo_id = r.id AND a.snapshot_type = 'source'
				   )`
			)
			.get() as { c: number }
	).c;
}

/** GH Archive hour ingested but no completed search stat for the same hour. */
export function hasCurrentHourSearchGap(): boolean {
	const db = getDb();
	const hourKey = defaultHourKey();
	const ghRow = db
		.prepare(
			`SELECT 1 FROM ingestion_state
			 WHERE hour_key = ? AND source = 'gharchive' AND unavailable_at IS NULL`
		)
		.get(hourKey);
	if (!ghRow) return false;

	const searchRow = db
		.prepare(
			`SELECT 1 FROM search_ingest_stats
			 WHERE hour_key = ? AND status = 'completed'
			 LIMIT 1`
		)
		.get(hourKey);
	return !searchRow;
}

export function countBackfillPendingHours(): number {
	const job = getActiveBackfillJob();
	if (!job) return 0;
	return getBackfillProgress(job.id).pending;
}

export function queryBacklogSnapshot(opts: { rateLimitedUntil?: string | null } = {}): BacklogSnapshot {
	return {
		missingGhArchiveHours: listMissingHourKeys().length,
		currentHourSearchGap: hasCurrentHourSearchGap(),
		backfillPendingHours: countBackfillPendingHours(),
		unenriched: countUnenriched(),
		staleRefresh: countReposDueForRefresh(),
		unarchivedSource: countUnarchivedSourceSnapshots(),
		rateLimitedUntil: opts.rateLimitedUntil ?? null
	};
}
