/**
 * Assembles BacklogSnapshot from SQLite for daemon-planner.ts.
 */

import { getActiveBackfillJob, getBackfillProgress } from '$lib/server/db/backfill';
import { getDb } from '$lib/server/db/connection';
import { countMissingGhArchiveHours } from '$lib/server/db/ingestion';
import { countReposDueForRefresh, countUnenriched } from '$lib/server/db/repos';
import {
	hasCompletedSearchForHour,
	isHourSearchReconciled
} from '$lib/server/db/search-ingest';
import { defaultHourKey } from '$lib/server/gharchive';
import { isMetadataOnlyMode } from '$lib/server/runtime-mode';
import type { BacklogSnapshot } from '$lib/server/daemon-planner';

export function countUnarchivedSourceSnapshots(): number {
	if (isMetadataOnlyMode()) return 0;

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

/**
 * Search gap only when the current hour still needs a Search pass.
 * Skip when Search already completed/reconciled, or when GH Archive alone
 * already matched repository births (no search_ingest_stats rows yet).
 */
export function hasCurrentHourSearchGap(): boolean {
	const db = getDb();
	const hourKey = defaultHourKey();
	const ghRow = db
		.prepare(
			`SELECT events, source FROM ingestion_state
			 WHERE hour_key = ? AND unavailable_at IS NULL`
		)
		.get(hourKey) as { events: number; source: string } | undefined;
	if (!ghRow) return false;

	if (hasCompletedSearchForHour(hourKey) || isHourSearchReconciled(hourKey)) return false;

	const anySearchAttempt = db
		.prepare(`SELECT 1 AS ok FROM search_ingest_stats WHERE hour_key = ? LIMIT 1`)
		.get(hourKey);
	// Archive-only ingest with matched creates — Search is optional, not a gap.
	if (!anySearchAttempt && ghRow.source === 'gharchive' && ghRow.events > 0) {
		return false;
	}

	return true;
}

export function countBackfillPendingHours(): number {
	const job = getActiveBackfillJob();
	if (!job) return 0;
	return getBackfillProgress(job.id).pending;
}

export function queryBacklogSnapshot(
	opts: { rateLimitedUntil?: string | null; nowMs?: number } = {}
): BacklogSnapshot {
	const nowMs = opts.nowMs ?? Date.now();
	return {
		missingGhArchiveHours: countMissingGhArchiveHours(nowMs),
		currentHourSearchGap: hasCurrentHourSearchGap(),
		backfillPendingHours: countBackfillPendingHours(),
		unenriched: countUnenriched(),
		staleRefresh: countReposDueForRefresh(),
		unarchivedSource: countUnarchivedSourceSnapshots(),
		rateLimitedUntil: opts.rateLimitedUntil ?? null
	};
}
