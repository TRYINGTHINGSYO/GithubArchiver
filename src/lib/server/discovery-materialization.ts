import { randomBytes } from 'node:crypto';
import { getDb } from './db/connection.js';

/** Bump when materializer payload shape or section selection rules change. */
export const DISCOVERY_MATERIALIZATION_ALGORITHM_VERSION = 1;

/**
 * Explicit freshness window for homepage discovery materialization.
 * Default 2h (daemon interval is 1h). Override via env for ops tuning.
 */
export function discoveryMaterializationStaleMs(): number {
	const n = Number(process.env.DISCOVERY_MATERIALIZATION_STALE_MS ?? 2 * 60 * 60 * 1000);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2 * 60 * 60 * 1000;
}

export function discoveryMaterializationLeaseMs(): number {
	const n = Number(process.env.DISCOVERY_MATERIALIZATION_LEASE_MS ?? 15 * 60 * 1000);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15 * 60 * 1000;
}

export type MaterializationRunStatus =
	| 'running'
	| 'success'
	| 'failed'
	| 'skipped_deduped';

export interface DiscoverySectionRowCounts {
	projects_to_watch: number;
	fastest_clusters: number;
	deleted_preserved: number;
	unusual_finds: number;
	emerging_topics: number;
}

export interface DiscoveryMaterializationRunRow {
	id: number;
	status: MaterializationRunStatus;
	started_at: string;
	finished_at: string | null;
	source_commit: string | null;
	algorithm_version: number;
	lease_owner: string | null;
	lease_expires_at: string | null;
	error: string | null;
	row_counts_json: string | null;
	published: number;
}

export type ClaimMaterializationRunResult =
	| { claimed: true; runId: number; owner: string }
	| { claimed: false; reason: 'lease_held'; activeRunId: number; owner: string | null };

function resolveSourceCommit(): string | null {
	return (
		process.env.GITHUBARCHIVE_DEPLOYED_COMMIT ??
		process.env.RAILWAY_GIT_COMMIT_SHA ??
		process.env.GITHUB_SHA ??
		null
	);
}

function materializationRunsAvailable(): boolean {
	const db = getDb();
	const row = db
		.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
		.get('discovery_materialization_runs') as { ok: number } | undefined;
	return Boolean(row);
}

function expireStaleLeases(nowIso: string): void {
	const db = getDb();
	db.prepare(
		`UPDATE discovery_materialization_runs
		 SET status = 'failed',
		     finished_at = ?,
		     error = COALESCE(error, 'lease expired without publish'),
		     lease_owner = NULL,
		     lease_expires_at = NULL
		 WHERE status = 'running'
		   AND lease_expires_at IS NOT NULL
		   AND lease_expires_at < ?`
	).run(nowIso, nowIso);
}

/**
 * Cross-process exclusive claim. Uses BEGIN IMMEDIATE so concurrent triggers
 * (enrich side-effect, in-process cadence, CLI, admin) cannot double-run.
 */
export function tryClaimDiscoveryMaterializationRun(
	opts: { owner?: string; leaseMs?: number; now?: number } = {}
): ClaimMaterializationRunResult {
	if (!materializationRunsAvailable()) {
		// Pre-039 schema: allow the write path; durable lease is unavailable.
		return { claimed: true, runId: -1, owner: opts.owner ?? 'legacy' };
	}

	const db = getDb();
	const nowMs = opts.now ?? Date.now();
	const nowIso = new Date(nowMs).toISOString();
	const leaseMs = opts.leaseMs ?? discoveryMaterializationLeaseMs();
	const owner = opts.owner ?? `materialize-${process.pid}-${randomBytes(4).toString('hex')}`;
	const leaseExpires = new Date(nowMs + leaseMs).toISOString();
	const sourceCommit = resolveSourceCommit();

	return db.transaction(() => {
		expireStaleLeases(nowIso);
		const active = db
			.prepare(
				`SELECT id, lease_owner FROM discovery_materialization_runs
				 WHERE status = 'running'
				   AND (lease_expires_at IS NULL OR lease_expires_at >= ?)
				 ORDER BY id DESC LIMIT 1`
			)
			.get(nowIso) as { id: number; lease_owner: string | null } | undefined;
		if (active) {
			return {
				claimed: false as const,
				reason: 'lease_held' as const,
				activeRunId: active.id,
				owner: active.lease_owner
			};
		}

		const result = db
			.prepare(
				`INSERT INTO discovery_materialization_runs (
				   status, started_at, source_commit, algorithm_version,
				   lease_owner, lease_expires_at, published
				 ) VALUES ('running', ?, ?, ?, ?, ?, 0)`
			)
			.run(
				nowIso,
				sourceCommit,
				DISCOVERY_MATERIALIZATION_ALGORITHM_VERSION,
				owner,
				leaseExpires
			);

		return { claimed: true as const, runId: Number(result.lastInsertRowid), owner };
	})();
}

export function completeDiscoveryMaterializationRun(
	runId: number,
	opts: {
		status: Exclude<MaterializationRunStatus, 'running'>;
		rowCounts?: DiscoverySectionRowCounts | null;
		error?: string | null;
		published?: boolean;
		now?: number;
	}
): void {
	if (runId < 0 || !materializationRunsAvailable()) return;
	const db = getDb();
	const finishedAt = new Date(opts.now ?? Date.now()).toISOString();
	db.prepare(
		`UPDATE discovery_materialization_runs
		 SET status = ?,
		     finished_at = ?,
		     error = ?,
		     row_counts_json = ?,
		     published = ?,
		     lease_owner = NULL,
		     lease_expires_at = NULL
		 WHERE id = ?`
	).run(
		opts.status,
		finishedAt,
		opts.error ?? null,
		opts.rowCounts ? JSON.stringify(opts.rowCounts) : null,
		opts.published ? 1 : 0,
		runId
	);
}

export function getLatestPublishedDiscoveryMaterializationRun(): DiscoveryMaterializationRunRow | null {
	if (!materializationRunsAvailable()) return null;
	const db = getDb();
	return (
		(db
			.prepare(
				`SELECT * FROM discovery_materialization_runs
				 WHERE published = 1 AND status = 'success'
				 ORDER BY finished_at DESC, id DESC LIMIT 1`
			)
			.get() as DiscoveryMaterializationRunRow | undefined) ?? null
	);
}

export function getLatestDiscoveryMaterializationRun(): DiscoveryMaterializationRunRow | null {
	if (!materializationRunsAvailable()) return null;
	const db = getDb();
	return (
		(db
			.prepare(
				`SELECT * FROM discovery_materialization_runs
				 ORDER BY id DESC LIMIT 1`
			)
			.get() as DiscoveryMaterializationRunRow | undefined) ?? null
	);
}

export function isDiscoveryMaterializationStale(
	lastSuccessAt: string | null,
	now = Date.now()
): boolean {
	if (!lastSuccessAt) return true;
	const ts = Date.parse(lastSuccessAt);
	if (!Number.isFinite(ts)) return true;
	return now - ts > discoveryMaterializationStaleMs();
}

export function materializationAgeMs(lastSuccessAt: string | null, now = Date.now()): number | null {
	if (!lastSuccessAt) return null;
	const ts = Date.parse(lastSuccessAt);
	if (!Number.isFinite(ts)) return null;
	return Math.max(0, now - ts);
}
