import { getDb } from '$lib/server/db/connection';
import { insertRepo } from '$lib/server/db/repos';
import { appendRepoEvent } from '$lib/server/events';
import type { RepoCreateEvent } from '$lib/server/gharchive';

export interface GhArchiveCreateCommit {
	inserted: number;
	skipped: number;
}

/** Rows per write transaction. Small enough that the event loop can tick between
 *  batches (wall-clock abort, healthchecks) and large enough to amortize fsync. */
export function ingestCommitBatchSize(): number {
	const n = Number(process.env.INGEST_COMMIT_BATCH_SIZE ?? 200);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}

/**
 * Persist a slice of GH Archive repository creates in one write transaction.
 *
 * better-sqlite3 transactions are synchronous and block the Node event loop for
 * their whole duration. Callers must not pass an entire busy hour here — use
 * `commitGhArchiveCreates` which chunks and yields between batches.
 */
export function commitGhArchiveCreateBatch(
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

/**
 * Persist one hour of creates in chunked transactions, yielding to the event
 * loop between batches.
 *
 * History: per-event auto-commits (~5 fsyncs each under synchronous=FULL) made
 * every hour exceed the 10-minute wall-clock. A single transaction for the whole
 * hour fixed the fsync tax but blocked the event loop for minutes on a busy
 * hour, so the wall-clock timer and Railway healthchecks could not fire. Chunked
 * commits keep the fsync amortization and give the event loop a tick every batch.
 */
export async function commitGhArchiveCreates(
	events: RepoCreateEvent[],
	firstSeenAt: string,
	batchSize: number = ingestCommitBatchSize()
): Promise<GhArchiveCreateCommit> {
	let inserted = 0;
	let skipped = 0;
	for (let i = 0; i < events.length; i += batchSize) {
		const slice = events.slice(i, i + batchSize);
		const result = commitGhArchiveCreateBatch(slice, firstSeenAt);
		inserted += result.inserted;
		skipped += result.skipped;
		// setImmediate, not setTimeout(0): yield after the current I/O callbacks
		// so a waiting wall-clock rejection can win the Promise.race.
		if (i + batchSize < events.length) {
			await new Promise<void>((resolve) => setImmediate(resolve));
		}
	}
	return { inserted, skipped };
}
