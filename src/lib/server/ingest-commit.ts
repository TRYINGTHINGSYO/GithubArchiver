import { getDb } from '$lib/server/db/connection';
import { insertRepo } from '$lib/server/db/repos';
import { appendRepoEvent } from '$lib/server/events';
import type { RepoCreateEvent } from '$lib/server/gharchive';

export interface GhArchiveCreateCommit {
	inserted: number;
	skipped: number;
}

/**
 * Persist one hour of GH Archive repository creates in a single write transaction.
 *
 * The previous path called insertRepo + appendRepoEvent once per event, and each
 * call was its own auto-commit. On a network volume with the SQLite default of
 * synchronous=FULL that is roughly five fsyncs per create — enough to push a
 * single hour past the 10-minute ingest wall-clock. better-sqlite3 transactions
 * are synchronous, so events are collected during the stream and committed here
 * afterwards: a wall-clock abort mid-stream leaves the database untouched.
 */
export function commitGhArchiveCreates(
	events: RepoCreateEvent[],
	firstSeenAt: string
): GhArchiveCreateCommit {
	const db = getDb();
	return db.transaction(() => {
		let inserted = 0;
		let skipped = 0;
		for (const event of events) {
			const result = insertRepo({
				...event,
				first_seen_at: firstSeenAt,
				discovery_source: 'gharchive'
			});
			if (result.status === 'inserted' && result.id) {
				inserted++;
				appendRepoEvent(
					result.id,
					'first_seen',
					{
						full_name: event.full_name,
						github_url: event.github_url,
						event_id: event.event_id,
						created_at: event.created_at,
						discovery_source: 'gharchive'
					},
					firstSeenAt
				);
			} else {
				skipped++;
			}
		}
		return { inserted, skipped };
	})();
}
