import { getDb } from './connection.js';
import type { BacklogSnapshot } from '$lib/server/daemon-planner';
import { hasAnyBacklog, type DaemonAction } from '$lib/server/daemon-planner';

export interface DaemonDecisionRow {
	id: number;
	decided_at: string;
	action: string;
	reason: string;
	backlog_json: string;
	job_run_id: number | null;
}

export interface DaemonDecisionActionCount {
	action: string;
	count: number;
}

export interface DaemonDecisionSummary {
	since: string;
	hours: number;
	total: number;
	byAction: DaemonDecisionActionCount[];
	idleWithBacklog: number;
	idleWithBacklogRateLimited: number;
	idleWithBacklogUnexpected: number;
	unexpectedIdleSamples: { id: number; decided_at: string; reason: string; backlog: BacklogSnapshot }[];
}

function parseBacklog(json: string): BacklogSnapshot {
	try {
		return JSON.parse(json) as BacklogSnapshot;
	} catch {
		return {
			missingGhArchiveHours: 0,
			currentHourSearchGap: false,
			backfillPendingHours: 0,
			unenriched: 0,
			staleRefresh: 0,
			unarchivedSource: 0,
			rateLimitedUntil: null
		};
	}
}

export function isRateLimitIdleReason(reason: string): boolean {
	return reason.toLowerCase().includes('rate limit');
}

export function isUnexpectedIdleWithBacklog(
	action: string,
	reason: string,
	backlog: BacklogSnapshot,
	nowMs: number = Date.now()
): boolean {
	if (action !== 'idle' || !hasAnyBacklog(backlog)) return false;
	if (backlog.rateLimitedUntil && nowMs < Date.parse(backlog.rateLimitedUntil)) return false;
	if (isRateLimitIdleReason(reason)) return false;
	return true;
}

export function summarizeDaemonDecisions(hours = 24): DaemonDecisionSummary {
	const db = getDb();
	const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
	const byAction = db
		.prepare(
			`SELECT action, COUNT(*) as count
			 FROM daemon_decisions
			 WHERE decided_at >= ?
			 GROUP BY action
			 ORDER BY count DESC`
		)
		.all(since) as DaemonDecisionActionCount[];

	const idleRows = db
		.prepare(
			`SELECT id, decided_at, action, reason, backlog_json
			 FROM daemon_decisions
			 WHERE decided_at >= ? AND action = 'idle'`
		)
		.all(since) as DaemonDecisionRow[];

	let idleWithBacklog = 0;
	let idleWithBacklogRateLimited = 0;
	let idleWithBacklogUnexpected = 0;
	const unexpectedIdleSamples: DaemonDecisionSummary['unexpectedIdleSamples'] = [];

	for (const row of idleRows) {
		const backlog = parseBacklog(row.backlog_json);
		if (!hasAnyBacklog(backlog)) continue;
		idleWithBacklog++;
		const rateLimited =
			isRateLimitIdleReason(row.reason) ||
			Boolean(backlog.rateLimitedUntil && Date.parse(backlog.rateLimitedUntil) > Date.parse(row.decided_at));
		if (rateLimited) {
			idleWithBacklogRateLimited++;
		} else if (isUnexpectedIdleWithBacklog(row.action, row.reason, backlog, Date.parse(row.decided_at))) {
			idleWithBacklogUnexpected++;
			if (unexpectedIdleSamples.length < 10) {
				unexpectedIdleSamples.push({
					id: row.id,
					decided_at: row.decided_at,
					reason: row.reason,
					backlog
				});
			}
		}
	}

	const total = byAction.reduce((sum, row) => sum + row.count, 0);

	return {
		since,
		hours,
		total,
		byAction,
		idleWithBacklog,
		idleWithBacklogRateLimited,
		idleWithBacklogUnexpected,
		unexpectedIdleSamples
	};
}

export function insertDaemonDecision(opts: {
	action: DaemonAction;
	reason: string;
	backlog: BacklogSnapshot;
	jobRunId?: number | null;
}): number {
	const db = getDb();
	const result = db
		.prepare(
			`INSERT INTO daemon_decisions (decided_at, action, reason, backlog_json, job_run_id)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.run(
			new Date().toISOString(),
			opts.action,
			opts.reason,
			JSON.stringify(opts.backlog),
			opts.jobRunId ?? null
		);
	return Number(result.lastInsertRowid);
}

export function listRecentDaemonDecisions(limit = 30): DaemonDecisionRow[] {
	const db = getDb();
	return db
		.prepare('SELECT * FROM daemon_decisions ORDER BY decided_at DESC LIMIT ?')
		.all(limit) as DaemonDecisionRow[];
}
