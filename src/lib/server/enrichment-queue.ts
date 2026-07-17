import { getDb } from './db/connection.js';
import type { RepoRow } from './db/types.js';
import {
	scoreRepoEnrichmentPriority,
	type EnrichmentDepth,
	type EnrichmentStatus,
	type EnrichmentTier
} from './enrichment-priority.js';

export interface EnrichmentQueueRepo extends RepoRow {
	enrichment_status: EnrichmentStatus;
	enrichment_priority: number;
	enrichment_tier: EnrichmentTier;
	enrichment_depth: EnrichmentDepth;
	next_enrichment_at: string | null;
	enrichment_attempts: number;
	last_enrichment_error: string | null;
	enrichment_claimed_by: string | null;
	enrichment_claimed_at: string | null;
	enrichment_claim_expires_at: string | null;
	enrichment_etag: string | null;
	last_enrichment_http_status: number | null;
}

const CLAIM_TTL_MS = Number(process.env.ENRICH_CLAIM_TTL_MS ?? 5 * 60_000);
const RETRY_LIMIT = Number(process.env.ENRICH_RETRY_LIMIT ?? 5);

function nowIso(ms = Date.now()): string {
	return new Date(ms).toISOString();
}

export function releaseExpiredEnrichmentClaims(now = Date.now()): number {
	const db = getDb();
	const result = db
		.prepare(
			`UPDATE repos
			 SET enrichment_claimed_by = NULL,
			     enrichment_claimed_at = NULL,
			     enrichment_claim_expires_at = NULL,
			     enrichment_status = CASE
			       WHEN enrichment_status = 'claimed' THEN 'retry'
			       ELSE enrichment_status
			     END
			 WHERE enrichment_claim_expires_at IS NOT NULL
			   AND enrichment_claim_expires_at < ?`
		)
		.run(nowIso(now));
	return result.changes;
}

/**
 * Atomically claim a batch of enrichment-eligible repositories.
 * Network I/O must happen outside any surrounding write transaction.
 */
export function claimEnrichmentBatch(
	limit: number,
	workerId: string,
	opts: { includeDeferred?: boolean; deepUpgrade?: boolean } = {}
): EnrichmentQueueRepo[] {
	releaseExpiredEnrichmentClaims();
	const db = getDb();
	const now = Date.now();
	const nowStr = nowIso(now);
	const expires = nowIso(now + CLAIM_TTL_MS);
	const tiers = opts.includeDeferred
		? ['urgent', 'high', 'normal', 'low', 'deferred']
		: ['urgent', 'high', 'normal', 'low'];

	const claimed = db.transaction(() => {
		const ids = (
			opts.deepUpgrade
				? db
						.prepare(
							`SELECT id FROM repos
							 WHERE enrichment_depth = 'fast'
							   AND deleted_at IS NULL
							   AND COALESCE(interesting_score, 0) >= 55
							   AND (next_enrichment_at IS NULL OR next_enrichment_at <= ?)
							   AND (enrichment_claim_expires_at IS NULL OR enrichment_claim_expires_at < ?)
							 ORDER BY interesting_score DESC, enrichment_priority DESC
							 LIMIT ?`
						)
						.all(nowStr, nowStr, limit)
				: db
						.prepare(
							`SELECT id FROM repos
							 WHERE enriched_at IS NULL
							   AND deleted_at IS NULL
							   AND enrichment_status IN ('pending', 'retry', 'deferred')
							   AND enrichment_tier IN (${tiers.map(() => '?').join(',')})
							   AND (next_enrichment_at IS NULL OR next_enrichment_at <= ?)
							   AND (enrichment_claim_expires_at IS NULL OR enrichment_claim_expires_at < ?)
							   AND enrichment_attempts < ?
							 ORDER BY
							   CASE enrichment_tier
							     WHEN 'urgent' THEN 0
							     WHEN 'high' THEN 1
							     WHEN 'normal' THEN 2
							     WHEN 'low' THEN 3
							     ELSE 4
							   END,
							   enrichment_priority DESC,
							   created_at DESC
							 LIMIT ?`
						)
						.all(...tiers, nowStr, nowStr, RETRY_LIMIT, limit)
		) as { id: number }[];

		if (ids.length === 0) return [] as number[];

		const update = db.prepare(
			`UPDATE repos
			 SET enrichment_status = 'claimed',
			     enrichment_claimed_by = ?,
			     enrichment_claimed_at = ?,
			     enrichment_claim_expires_at = ?,
			     enrichment_attempts = enrichment_attempts + 1
			 WHERE id = ?
			   AND (enrichment_claim_expires_at IS NULL OR enrichment_claim_expires_at < ?)`
		);

		const claimedIds: number[] = [];
		for (const row of ids) {
			const result = update.run(workerId, nowStr, expires, row.id, nowStr);
			if (result.changes > 0) claimedIds.push(row.id);
		}
		return claimedIds;
	})();

	if (claimed.length === 0) return [];

	return db
		.prepare(
			`SELECT * FROM repos WHERE id IN (${claimed.map(() => '?').join(',')})
			 ORDER BY
			   CASE enrichment_tier
			     WHEN 'urgent' THEN 0
			     WHEN 'high' THEN 1
			     WHEN 'normal' THEN 2
			     WHEN 'low' THEN 3
			     ELSE 4
			   END,
			   enrichment_priority DESC`
		)
		.all(...claimed) as EnrichmentQueueRepo[];
}

export function markEnrichmentSuccess(
	repoId: number,
	depth: EnrichmentDepth,
	opts: { etag?: string | null; httpStatus?: number } = {}
): void {
	const db = getDb();
	db.prepare(
		`UPDATE repos SET
		   enrichment_status = 'done',
		   enrichment_depth = ?,
		   next_enrichment_at = NULL,
		   last_enrichment_error = NULL,
		   enrichment_claimed_by = NULL,
		   enrichment_claimed_at = NULL,
		   enrichment_claim_expires_at = NULL,
		   enrichment_etag = COALESCE(?, enrichment_etag),
		   last_enrichment_http_status = ?,
		   enrichment_level = CASE
		     WHEN ? = 'deep' THEN MAX(COALESCE(enrichment_level, 0), 2)
		     ELSE MAX(COALESCE(enrichment_level, 0), 1)
		   END
		 WHERE id = ?`
	).run(depth, opts.etag ?? null, opts.httpStatus ?? 200, depth, repoId);
}

export function scheduleEnrichmentRetry(
	repoId: number,
	error: string,
	opts: {
		status?: EnrichmentStatus;
		delayMs: number;
		httpStatus?: number | null;
	}
): void {
	const db = getDb();
	const next = nowIso(Date.now() + opts.delayMs);
	db.prepare(
		`UPDATE repos SET
		   enrichment_status = ?,
		   next_enrichment_at = ?,
		   last_enrichment_error = ?,
		   last_enrichment_http_status = ?,
		   enrichment_claimed_by = NULL,
		   enrichment_claimed_at = NULL,
		   enrichment_claim_expires_at = NULL
		 WHERE id = ?`
	).run(opts.status ?? 'retry', next, error.slice(0, 1000), opts.httpStatus ?? null, repoId);
}

export function recomputeEnrichmentPriority(repoId: number): void {
	const db = getDb();
	const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(repoId) as EnrichmentQueueRepo | undefined;
	if (!repo) return;
	if (repo.enriched_at) {
		db.prepare(
			`UPDATE repos SET enrichment_status = 'done',
			  enrichment_depth = CASE WHEN enrichment_level >= 2 THEN 'deep' ELSE 'fast' END,
			  next_enrichment_at = NULL
			 WHERE id = ?`
		).run(repoId);
		return;
	}
	const eventCount = (
		db.prepare('SELECT COUNT(*) AS c FROM repository_events WHERE repo_id = ?').get(repoId) as {
			c: number;
		}
	).c;
	const scored = scoreRepoEnrichmentPriority(repo, eventCount);
	db.prepare(
		`UPDATE repos SET
		   enrichment_priority = ?,
		   enrichment_tier = ?,
		   enrichment_status = CASE
		     WHEN enrichment_status IN ('unavailable', 'forbidden', 'terminal', 'claimed') THEN enrichment_status
		     WHEN ? = 'deferred' THEN 'deferred'
		     ELSE 'pending'
		   END,
		   next_enrichment_at = COALESCE(next_enrichment_at, datetime('now')),
		   enrichment_depth = COALESCE(enrichment_depth, 'none')
		 WHERE id = ?`
	).run(scored.priority, scored.tier, scored.tier, repoId);
}

export function seedEnrichmentPriorityForInsert(repoId: number): void {
	recomputeEnrichmentPriority(repoId);
}

export function countEnrichmentBacklogByTier(): Record<EnrichmentTier, number> {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT enrichment_tier AS tier, COUNT(*) AS c
			 FROM repos
			 WHERE enriched_at IS NULL AND deleted_at IS NULL
			 GROUP BY enrichment_tier`
		)
		.all() as { tier: EnrichmentTier; c: number }[];
	const out: Record<EnrichmentTier, number> = {
		urgent: 0,
		high: 0,
		normal: 0,
		low: 0,
		deferred: 0
	};
	for (const row of rows) {
		if (row.tier in out) out[row.tier] = row.c;
	}
	return out;
}

export function countEnrichmentByDepth(): { none: number; fast: number; deep: number } {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT COALESCE(enrichment_depth, 'none') AS depth, COUNT(*) AS c
			 FROM repos
			 GROUP BY COALESCE(enrichment_depth, 'none')`
		)
		.all() as { depth: string; c: number }[];
	const out = { none: 0, fast: 0, deep: 0 };
	for (const row of rows) {
		if (row.depth === 'fast') out.fast = row.c;
		else if (row.depth === 'deep') out.deep = row.c;
		else out.none += row.c;
	}
	return out;
}
