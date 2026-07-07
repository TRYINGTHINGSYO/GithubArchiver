import { getDb } from './connection.js';
import type { BacklogSnapshot } from '$lib/server/daemon-planner';
import type { DaemonAction } from '$lib/server/daemon-planner';

export interface DaemonDecisionRow {
	id: number;
	decided_at: string;
	action: string;
	reason: string;
	backlog_json: string;
	job_run_id: number | null;
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
