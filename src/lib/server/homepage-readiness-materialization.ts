import { randomBytes } from 'node:crypto';
import { CURRENT_SCHEMA_VERSION } from './db/schema.js';
import { getDb } from './db/connection.js';
import type { DataReadiness } from './data-readiness.js';
import type { DiscoveryRepoCard } from './discovery.js';

/** Bump when readiness/high-signal snapshot payload shape changes. */
export const HOMEPAGE_READINESS_ALGORITHM_VERSION = 1;

export function homepageReadinessStaleMs(): number {
	const n = Number(process.env.HOMEPAGE_READINESS_STALE_MS ?? 15 * 60 * 1000);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15 * 60 * 1000;
}

export function homepageReadinessLeaseMs(): number {
	const n = Number(process.env.HOMEPAGE_READINESS_LEASE_MS ?? 10 * 60 * 1000);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10 * 60 * 1000;
}

export type HomepageReadinessRunStatus =
	| 'running'
	| 'success'
	| 'failed'
	| 'skipped_deduped';

export interface HomepageSourceWatermarks {
	enrichedAt: string | null;
	classifiedAt: string | null;
	repoCount: number;
}

export interface HomepageReadinessSnapshotRow {
	id: number;
	run_id: number;
	published_at: string;
	algorithm_version: number;
	schema_version: number;
	window_days: number;
	readiness_json: string;
	high_signal_json: string;
	high_signal_count: number;
	watermark_enriched_at: string | null;
	watermark_classified_at: string | null;
	watermark_repo_count: number;
}

export interface HomepageReadinessPublishedSnapshot {
	runId: number;
	publishedAt: string;
	algorithmVersion: number;
	schemaVersion: number;
	windowDays: number;
	readiness: DataReadiness;
	highSignalRepos: DiscoveryRepoCard[];
	highSignalCount: number;
	watermarks: HomepageSourceWatermarks;
}

export type ClaimHomepageReadinessRunResult =
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

function runsTableAvailable(): boolean {
	const db = getDb();
	return Boolean(
		db
			.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
			.get('homepage_readiness_runs')
	);
}

function snapshotTableAvailable(): boolean {
	const db = getDb();
	return Boolean(
		db
			.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
			.get('homepage_readiness_snapshot')
	);
}

function expireStaleLeases(nowIso: string): void {
	const db = getDb();
	db.prepare(
		`UPDATE homepage_readiness_runs
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

export function readHomepageSourceWatermarks(): HomepageSourceWatermarks {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT
			   MAX(enriched_at) AS enriched_at,
			   MAX(classified_at) AS classified_at,
			   COUNT(*) AS repo_count
			 FROM repos`
		)
		.get() as {
		enriched_at: string | null;
		classified_at: string | null;
		repo_count: number;
	};
	return {
		enrichedAt: row.enriched_at ?? null,
		classifiedAt: row.classified_at ?? null,
		repoCount: row.repo_count ?? 0
	};
}

export function tryClaimHomepageReadinessRun(
	opts: { owner?: string; leaseMs?: number; now?: number } = {}
): ClaimHomepageReadinessRunResult {
	if (!runsTableAvailable()) {
		return { claimed: true, runId: -1, owner: opts.owner ?? 'legacy' };
	}

	const db = getDb();
	const nowMs = opts.now ?? Date.now();
	const nowIso = new Date(nowMs).toISOString();
	const leaseMs = opts.leaseMs ?? homepageReadinessLeaseMs();
	const owner = opts.owner ?? `readiness-${process.pid}-${randomBytes(4).toString('hex')}`;
	const leaseExpires = new Date(nowMs + leaseMs).toISOString();

	return db.transaction(() => {
		expireStaleLeases(nowIso);
		const active = db
			.prepare(
				`SELECT id, lease_owner FROM homepage_readiness_runs
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
				`INSERT INTO homepage_readiness_runs (
				   status, started_at, source_commit, algorithm_version, schema_version,
				   lease_owner, lease_expires_at, published
				 ) VALUES ('running', ?, ?, ?, ?, ?, ?, 0)`
			)
			.run(
				nowIso,
				resolveSourceCommit(),
				HOMEPAGE_READINESS_ALGORITHM_VERSION,
				CURRENT_SCHEMA_VERSION,
				owner,
				leaseExpires
			);

		return { claimed: true as const, runId: Number(result.lastInsertRowid), owner };
	})();
}

export function completeHomepageReadinessRun(
	runId: number,
	opts: {
		status: Exclude<HomepageReadinessRunStatus, 'running'>;
		error?: string | null;
		published?: boolean;
		snapshotId?: number | null;
		now?: number;
	}
): void {
	if (runId < 0 || !runsTableAvailable()) return;
	const db = getDb();
	const finishedAt = new Date(opts.now ?? Date.now()).toISOString();
	db.prepare(
		`UPDATE homepage_readiness_runs
		 SET status = ?,
		     finished_at = ?,
		     error = ?,
		     published = ?,
		     snapshot_id = ?,
		     lease_owner = NULL,
		     lease_expires_at = NULL
		 WHERE id = ?`
	).run(
		opts.status,
		finishedAt,
		opts.error ?? null,
		opts.published ? 1 : 0,
		opts.snapshotId ?? null,
		runId
	);
}

export function getPublishedHomepageReadinessSnapshot(): HomepageReadinessPublishedSnapshot | null {
	if (!snapshotTableAvailable()) return null;
	const db = getDb();
	const row = db
		.prepare(`SELECT * FROM homepage_readiness_snapshot WHERE id = 1`)
		.get() as HomepageReadinessSnapshotRow | undefined;
	if (!row) return null;
	try {
		return {
			runId: row.run_id,
			publishedAt: row.published_at,
			algorithmVersion: row.algorithm_version,
			schemaVersion: row.schema_version,
			windowDays: row.window_days,
			readiness: JSON.parse(row.readiness_json) as DataReadiness,
			highSignalRepos: JSON.parse(row.high_signal_json) as DiscoveryRepoCard[],
			highSignalCount: row.high_signal_count,
			watermarks: {
				enrichedAt: row.watermark_enriched_at,
				classifiedAt: row.watermark_classified_at,
				repoCount: row.watermark_repo_count
			}
		};
	} catch {
		return null;
	}
}

export function publishHomepageReadinessSnapshot(opts: {
	runId: number;
	windowDays: number;
	readiness: DataReadiness;
	highSignalRepos: DiscoveryRepoCard[];
	highSignalCount: number;
	watermarks: HomepageSourceWatermarks;
	publishedAt?: string;
}): void {
	const db = getDb();
	const publishedAt = opts.publishedAt ?? new Date().toISOString();
	db.prepare(
		`INSERT INTO homepage_readiness_snapshot (
		   id, run_id, published_at, algorithm_version, schema_version, window_days,
		   readiness_json, high_signal_json, high_signal_count,
		   watermark_enriched_at, watermark_classified_at, watermark_repo_count
		 ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   run_id = excluded.run_id,
		   published_at = excluded.published_at,
		   algorithm_version = excluded.algorithm_version,
		   schema_version = excluded.schema_version,
		   window_days = excluded.window_days,
		   readiness_json = excluded.readiness_json,
		   high_signal_json = excluded.high_signal_json,
		   high_signal_count = excluded.high_signal_count,
		   watermark_enriched_at = excluded.watermark_enriched_at,
		   watermark_classified_at = excluded.watermark_classified_at,
		   watermark_repo_count = excluded.watermark_repo_count`
	).run(
		opts.runId < 0 ? 0 : opts.runId,
		publishedAt,
		HOMEPAGE_READINESS_ALGORITHM_VERSION,
		CURRENT_SCHEMA_VERSION,
		opts.windowDays,
		JSON.stringify(opts.readiness),
		JSON.stringify(opts.highSignalRepos),
		opts.highSignalCount,
		opts.watermarks.enrichedAt,
		opts.watermarks.classifiedAt,
		opts.watermarks.repoCount
	);
}

export function isHomepageReadinessAgeStale(publishedAt: string | null, now = Date.now()): boolean {
	if (!publishedAt) return true;
	const ts = Date.parse(publishedAt);
	if (!Number.isFinite(ts)) return true;
	return now - ts > homepageReadinessStaleMs();
}

export function homepageReadinessWatermarksMatch(
	snapshot: HomepageSourceWatermarks,
	current: HomepageSourceWatermarks
): boolean {
	return (
		snapshot.repoCount === current.repoCount &&
		snapshot.enrichedAt === current.enrichedAt &&
		snapshot.classifiedAt === current.classifiedAt
	);
}

/**
 * Snapshot is usable when present, algorithm/schema match, age is fresh,
 * and source watermarks still match the live corpus.
 */
export function isHomepageReadinessSnapshotFresh(
	snapshot: HomepageReadinessPublishedSnapshot | null,
	opts: { now?: number; currentWatermarks?: HomepageSourceWatermarks } = {}
): boolean {
	if (!snapshot) return false;
	if (snapshot.algorithmVersion !== HOMEPAGE_READINESS_ALGORITHM_VERSION) return false;
	if (snapshot.schemaVersion !== CURRENT_SCHEMA_VERSION) return false;
	if (isHomepageReadinessAgeStale(snapshot.publishedAt, opts.now ?? Date.now())) return false;
	const current = opts.currentWatermarks ?? readHomepageSourceWatermarks();
	return homepageReadinessWatermarksMatch(snapshot.watermarks, current);
}

export function getLatestHomepageReadinessRun(): {
	id: number;
	status: string;
	started_at: string;
	finished_at: string | null;
	published: number;
	snapshot_id: number | null;
	error: string | null;
	algorithm_version: number;
	schema_version: number;
} | null {
	if (!runsTableAvailable()) return null;
	return (
		(getDb()
			.prepare(`SELECT * FROM homepage_readiness_runs ORDER BY id DESC LIMIT 1`)
			.get() as {
			id: number;
			status: string;
			started_at: string;
			finished_at: string | null;
			published: number;
			snapshot_id: number | null;
			error: string | null;
			algorithm_version: number;
			schema_version: number;
		} | undefined) ?? null
	);
}
