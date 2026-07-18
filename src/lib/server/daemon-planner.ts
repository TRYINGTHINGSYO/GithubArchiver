/**
 * Pure daemon priority planner — no I/O, fully unit-testable.
 * Backlog snapshot assembly lives in daemon-backlog.ts.
 * @see docs/PROPOSAL-autonomous-intelligence.md
 */

import type { JobType } from '$lib/server/db/types';

export const DAEMON_ACTIONS = [
	'ingest',
	'search_gap',
	'backfill',
	'enrich',
	'refresh',
	'archive',
	'idle'
] as const;

export type DaemonAction = (typeof DAEMON_ACTIONS)[number];

export interface BacklogSnapshot {
	missingGhArchiveHours: number;
	currentHourSearchGap: boolean;
	backfillPendingHours: number;
	unenriched: number;
	staleRefresh: number;
	unarchivedSource: number;
	rateLimitedUntil: string | null;
}

export interface RankedAction {
	action: DaemonAction;
	score: number;
}

export interface DaemonDecision {
	action: DaemonAction;
	reason: string;
	ranked: RankedAction[];
}

export function scoreAction(action: DaemonAction, backlog: BacklogSnapshot): number {
	switch (action) {
		case 'ingest':
			// Keep discovering new repos even with a large long-tail enrich backlog.
			return backlog.missingGhArchiveHours > 0 ? 150 + backlog.missingGhArchiveHours : 0;
		case 'backfill':
			return backlog.backfillPendingHours > 0 ? 90 + backlog.backfillPendingHours : 0;
		case 'search_gap':
			return backlog.currentHourSearchGap ? 85 : 0;
		case 'enrich':
			// High priority, but does not monopolize the planner over ingest.
			if (backlog.unenriched <= 0) return 0;
			return 120 + Math.min(40, Math.log10(backlog.unenriched + 1) * 10);
		case 'refresh':
			return backlog.staleRefresh > 0 ? 50 + Math.log10(backlog.staleRefresh + 1) * 8 : 0;
		case 'archive':
			return backlog.unarchivedSource > 0 ? 100 + Math.min(40, Math.log10(backlog.unarchivedSource + 1) * 10) : 0;
		case 'idle':
			return 0;
	}
}

const WORK_ACTIONS: DaemonAction[] = [
	'ingest',
	'backfill',
	'search_gap',
	'enrich',
	'refresh',
	'archive'
];

export function rankActions(backlog: BacklogSnapshot): RankedAction[] {
	return WORK_ACTIONS.map((action) => ({
		action,
		score: scoreAction(action, backlog)
	})).sort((a, b) => b.score - a.score || a.action.localeCompare(b.action));
}

export function formatReason(action: DaemonAction, backlog: BacklogSnapshot): string {
	const parts = [
		`${backlog.unenriched.toLocaleString()} unenriched`,
		`${backlog.staleRefresh.toLocaleString()} stale`,
		`${backlog.unarchivedSource.toLocaleString()} unarchived`
	];

	switch (action) {
		case 'ingest':
			return `${backlog.missingGhArchiveHours} missing GH Archive hour(s) → ingest`;
		case 'backfill':
			return `${backlog.backfillPendingHours} backfill hour(s) pending → backfill`;
		case 'search_gap':
			return 'Current hour needs search fallback → search_gap';
		case 'enrich':
			return `${parts[0]}, ${parts[1]} → enrich`;
		case 'refresh':
			return `${parts[0]}, ${parts[1]} → refresh`;
		case 'archive':
			return `${parts[2]}, ${parts[1]} → archive`;
		case 'idle':
			return 'All queues empty';
	}
}

export function hasAnyBacklog(backlog: BacklogSnapshot): boolean {
	return (
		backlog.missingGhArchiveHours > 0 ||
		backlog.currentHourSearchGap ||
		backlog.backfillPendingHours > 0 ||
		backlog.unenriched > 0 ||
		backlog.staleRefresh > 0 ||
		backlog.unarchivedSource > 0
	);
}

export function pickAction(
	backlog: BacklogSnapshot,
	nowMs: number = Date.now()
): DaemonDecision {
	if (backlog.rateLimitedUntil && nowMs < Date.parse(backlog.rateLimitedUntil)) {
		return {
			action: 'idle',
			reason: `GitHub rate limit until ${backlog.rateLimitedUntil}`,
			ranked: rankActions(backlog)
		};
	}

	const ranked = rankActions(backlog);
	const best = ranked[0];

	if (!best || best.score === 0) {
		return { action: 'idle', reason: 'All queues empty', ranked };
	}

	return {
		action: best.action,
		reason: formatReason(best.action, backlog),
		ranked
	};
}

export function randomSleepMs(sleepMinMs: number, sleepMaxMs: number): number {
	if (sleepMinMs >= sleepMaxMs) return sleepMinMs;
	return sleepMinMs + Math.floor(Math.random() * (sleepMaxMs - sleepMinMs + 1));
}

export function computeDaemonSleepMs(opts: {
	backlog: BacklogSnapshot;
	hadFailure: boolean;
	rateLimitResetAt?: string;
	failureStreak: number;
	sleepMinMs: number;
	sleepMaxMs: number;
	backoffBaseMs: number;
	backoffMaxMs: number;
	nowMs?: number;
	/** Test hook: fixed idle sleep instead of random */
	idleSleepMs?: number;
	/**
	 * Sleep while any work backlog remains. Defaults to ARCHIVE_BACKLOG_SLEEP_MS.
	 * Always wins over a larger sleepMinMs so stale 5-minute defaults cannot stall the loop.
	 */
	backlogSleepMs?: number;
	/** @deprecated Use backlogSleepMs — kept for call-site compatibility */
	archiveBacklogSleepMs?: number;
	archiveBacklogSleepThreshold?: number;
	/**
	 * Near-continuous enrich drain. When claimable enrich backlog is large, sleep this long
	 * (default ENRICH_BACKLOG_SLEEP_MS=2000) instead of the 30–60s discovery backlog sleep.
	 */
	enrichBacklogSleepMs?: number;
	enrichBacklogSleepThreshold?: number;
}): number {
	if (hasAnyBacklog(opts.backlog)) {
		const backlogSleep = resolveBacklogSleepMs(opts);
		const enrichThreshold =
			opts.enrichBacklogSleepThreshold ??
			Number(process.env.ENRICH_BACKLOG_SLEEP_THRESHOLD ?? 100);
		const enrichSleepRaw = Number(process.env.ENRICH_BACKLOG_SLEEP_MS ?? 2_000);
		const enrichSleep =
			opts.enrichBacklogSleepMs ?? (Number.isFinite(enrichSleepRaw) ? enrichSleepRaw : 2_000);
		// Discovery may run hourly; enrichment must not. Keep the loop hot while unenriched remains.
		if (opts.backlog.unenriched >= enrichThreshold) {
			return Math.min(opts.sleepMinMs, backlogSleep, enrichSleep);
		}
		// Prefer the explicit backlog sleep when the configured min is longer (common misconfig).
		return Math.min(opts.sleepMinMs, backlogSleep);
	}

	const now = opts.nowMs ?? Date.now();

	if (opts.hadFailure) {
		if (opts.rateLimitResetAt) {
			return Math.max(new Date(opts.rateLimitResetAt).getTime() - now, opts.backoffBaseMs);
		}
		return Math.min(opts.backoffBaseMs * 2 ** opts.failureStreak, opts.backoffMaxMs);
	}

	return opts.idleSleepMs ?? randomSleepMs(opts.sleepMinMs, opts.sleepMaxMs);
}

function resolveBacklogSleepMs(opts: {
	backlogSleepMs?: number;
	archiveBacklogSleepMs?: number;
	archiveBacklogSleepThreshold?: number;
	backlog: BacklogSnapshot;
	sleepMinMs: number;
}): number {
	const fromEnv = Number(process.env.ARCHIVE_BACKLOG_SLEEP_MS ?? 60_000);
	const configured =
		opts.backlogSleepMs ?? opts.archiveBacklogSleepMs ?? (Number.isFinite(fromEnv) ? fromEnv : 60_000);
	const threshold =
		opts.archiveBacklogSleepThreshold ?? Number(process.env.ARCHIVE_BACKLOG_SLEEP_THRESHOLD ?? 1000);
	// Large archive backlog: never exceed the dedicated archive/backlog sleep.
	if (opts.backlog.unarchivedSource >= threshold) {
		return configured;
	}
	return configured;
}

export function daemonActionJobType(action: DaemonAction): JobType | null {
	switch (action) {
		case 'ingest':
		case 'search_gap':
			return 'ingest';
		case 'backfill':
			return 'backfill';
		case 'enrich':
			return 'enrich';
		case 'refresh':
			return 'refresh';
		case 'archive':
			return 'archive';
		case 'idle':
			return null;
	}
}
