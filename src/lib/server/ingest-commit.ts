import { getDb } from '$lib/server/db/connection';
import { publishLiveEvent } from '$lib/server/event-bus';
import { scoreEnrichmentPriority } from '$lib/server/enrichment-priority';
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
 * Deliberately does not call insertRepo / seedEnrichmentPriority / indexRepoFtsById:
 * those paths each do SELECT + COUNT + UPDATE + FTS rebuild per row (~130ms on the
 * production volume). Scoring from CreateEvent fields is pure CPU and matches what
 * seedEnrichmentPriorityForInsert would compute for a brand-new zero-metadata repo.
 */
export function commitGhArchiveCreateBatch(
	events: RepoCreateEvent[],
	firstSeenAt: string
): GhArchiveCreateCommit {
	const db = getDb();
	const insert = db.prepare(
		`INSERT OR IGNORE INTO repos
		 (owner, name, full_name, github_url, event_id, created_at, first_seen_at,
		  discovery_source, enrichment_status, enrichment_priority, enrichment_tier,
		  enrichment_depth, next_enrichment_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 'gharchive', ?, ?, ?, 'none', ?)`
	);
	const insertEvent = db.prepare(
		`INSERT INTO repository_events (repo_id, event_type, event_time, payload_json)
		 VALUES (?, 'first_seen', ?, ?)`
	);
	const insertFts = db.prepare(
		`INSERT INTO repos_fts
		 (full_name, owner, name, description, language, license, topics, readme_text, repo_id)
		 VALUES (?, ?, ?, '', '', '', '', '', ?)`
	);

	const live: Array<{ repoId: number; event: RepoCreateEvent }> = [];

	const result = db.transaction(() => {
		let inserted = 0;
		let skipped = 0;
		for (const event of events) {
			const scored = scoreEnrichmentPriority({
				owner: event.owner,
				name: event.name,
				full_name: event.full_name,
				created_at: event.created_at,
				first_seen_at: firstSeenAt,
				event_count: 1,
				stars: 0
			});
			const status = scored.tier === 'deferred' ? 'deferred' : 'pending';
			const row = insert.run(
				event.owner,
				event.name,
				event.full_name,
				event.github_url,
				event.event_id,
				event.created_at,
				firstSeenAt,
				status,
				scored.priority,
				scored.tier,
				firstSeenAt
			);
			if (row.changes > 0) {
				const id = Number(row.lastInsertRowid);
				insertEvent.run(
					id,
					firstSeenAt,
					JSON.stringify({
						full_name: event.full_name,
						github_url: event.github_url,
						event_id: event.event_id,
						created_at: event.created_at,
						discovery_source: 'gharchive'
					})
				);
				insertFts.run(event.full_name, event.owner, event.name, id);
				live.push({ repoId: id, event });
				inserted++;
			} else {
				skipped++;
			}
		}
		return { inserted, skipped };
	})();

	// Publish after commit so a rolled-back chunk never appears on the live bus.
	for (const item of live) {
		publishLiveEvent({
			type: 'repo.created',
			repo_id: item.repoId,
			event_time: firstSeenAt,
			payload: {
				full_name: item.event.full_name,
				github_url: item.event.github_url,
				event_id: item.event.event_id,
				created_at: item.event.created_at,
				discovery_source: 'gharchive',
				archive_event_type: 'first_seen'
			}
		});
	}

	return result;
}

/**
 * Persist one hour of creates in chunked transactions, yielding to the event
 * loop between batches.
 *
 * History: per-event auto-commits (~5 fsyncs each under synchronous=FULL) made
 * every hour exceed the 10-minute wall-clock. A single transaction for the whole
 * hour fixed the fsync tax but blocked the event loop for minutes. Chunked
 * commits keep the amortization and give the event loop a tick every batch.
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
		if (i + batchSize < events.length) {
			await new Promise<void>((resolve) => setImmediate(resolve));
		}
	}
	return { inserted, skipped };
}
