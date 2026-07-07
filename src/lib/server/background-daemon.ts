import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBackfillBatch } from './backfill-runner';
import { queryBacklogSnapshot } from './daemon-backlog';
import {
	computeDaemonSleepMs,
	daemonActionJobType,
	hasAnyBacklog,
	pickAction,
	type DaemonAction
} from './daemon-planner';
import { insertDaemonDecision } from './db/daemon-decisions';
import { finishJobRun, reconcileOrphanedJobRuns, startJobRun, updateJobRun } from './db/jobs';
import { runArchiveCycle } from './workers/archive';
import { runEnrichCycle } from './workers/enrich';
import { runIngestCycle, isIngestCycleFailure } from './workers/ingest';
import { runRefreshCycle } from './workers/refresh';
import { runSearchGapCycle } from './workers/search-gap';

const SLEEP_MIN_MS = Number(process.env.DAEMON_SLEEP_MIN_MS ?? 5 * 60 * 1000);
const SLEEP_MAX_MS = Number(process.env.DAEMON_SLEEP_MAX_MS ?? 15 * 60 * 1000);
const BACKOFF_BASE_MS = Number(process.env.DAEMON_BACKOFF_BASE_MS ?? 60_000);
const BACKOFF_MAX_MS = Number(process.env.DAEMON_BACKOFF_MAX_MS ?? 15 * 60 * 1000);
const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
const LOG_FILE = join(DATA_DIR, 'worker.log');

let running = false;
let stopRequested = false;
let loopPromise: Promise<void> | null = null;
let daemonJobId: number | null = null;
let failureStreak = 0;
let phase = 'stopped' as string;
let sleepUntil: string | null = null;
let startedAt: string | null = null;
let rateLimitedUntil: string | null = null;

function ensureDataDir() {
	mkdirSync(DATA_DIR, { recursive: true });
}

function appendLog(line: string) {
	ensureDataDir();
	const stamp = new Date().toISOString();
	appendFileSync(LOG_FILE, `[${stamp}] ${line}\n`);
}

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

async function waitWithStop(ms: number): Promise<boolean> {
	const step = 1000;
	let remaining = ms;
	while (remaining > 0 && !stopRequested) {
		await sleep(Math.min(step, remaining));
		remaining -= step;
	}
	return !stopRequested;
}

interface ActionRunResult {
	hadFailure: boolean;
	rateLimitResetAt?: string;
	detail?: Record<string, unknown>;
}

async function runDaemonAction(action: DaemonAction): Promise<ActionRunResult> {
	switch (action) {
		case 'ingest': {
			const ingest = await runIngestCycle();
			appendLog(
				`[daemon] ingest: ${ingest.downloaded} downloaded, +${ingest.inserted} repos`
			);
			return {
				hadFailure: isIngestCycleFailure(ingest),
				detail: ingest
			};
		}
		case 'search_gap': {
			const search = await runSearchGapCycle();
			appendLog(`[daemon] search_gap: +${search.inserted} repos (${search.found} found)`);
			return {
				hadFailure: search.rateLimited,
				rateLimitResetAt: search.rateLimitResetAt,
				detail: search
			};
		}
		case 'backfill': {
			const backfill = await runBackfillBatch(undefined, 1);
			appendLog(`[daemon] backfill: processed ${backfill.processed} hour(s)`);
			return {
				hadFailure: backfill.failed > 0,
				detail: backfill
			};
		}
		case 'enrich': {
			const enrich = await runEnrichCycle();
			appendLog(`[daemon] enrich: ${enrich.enriched} enriched`);
			return {
				hadFailure: enrich.rateLimited,
				rateLimitResetAt: enrich.rateLimitResetAt,
				detail: enrich
			};
		}
		case 'refresh': {
			const refresh = await runRefreshCycle();
			appendLog(`[daemon] refresh: ${refresh.refreshed} refreshed`);
			return {
				hadFailure: refresh.rateLimited,
				rateLimitResetAt: refresh.rateLimitResetAt,
				detail: refresh
			};
		}
		case 'archive': {
			const archive = await runArchiveCycle();
			appendLog(`[daemon] archive: ${archive.saved} saved, ${archive.blocked} blocked, ${archive.issues} issues`);
			return {
				hadFailure: archive.rateLimited,
				rateLimitResetAt: archive.rateLimitResetAt,
				detail: archive
			};
		}
		case 'idle':
			return { hadFailure: false };
	}
}

async function runLoop(): Promise<void> {
	startedAt = new Date().toISOString();
	daemonJobId = startJobRun('daemon', {
		pid: process.pid,
		started_at: startedAt,
		phase: 'starting',
		in_process: true,
		autonomous: true
	});

	appendLog(`daemon started in-process (pid ${process.pid})`);
	console.log(`[daemon] started in-process (pid ${process.pid})`);

	while (!stopRequested) {
		const loopStarted = new Date().toISOString();
		const backlog = queryBacklogSnapshot({ rateLimitedUntil });
		const decision = pickAction(backlog);

		phase = decision.action;
		sleepUntil = null;
		updateJobRun(daemonJobId, {
			pid: process.pid,
			started_at: startedAt,
			phase,
			loop_started: loopStarted,
			failure_streak: failureStreak,
			in_process: true,
			last_decision: decision,
			backlog
		});

		let hadFailure = false;
		let rateLimitResetAt: string | undefined;
		let childJobId: number | null = null;

		try {
			appendLog(`[daemon] decision: ${decision.reason}`);

			if (decision.action !== 'idle') {
				const jobType = daemonActionJobType(decision.action);
				if (jobType) {
					childJobId = startJobRun(
						jobType,
						{
							daemon_action: decision.action,
							backlog,
							ranked: decision.ranked,
							parent_daemon_job_id: daemonJobId
						},
						decision.reason
					);
				}
			}

			insertDaemonDecision({
				action: decision.action,
				reason: decision.reason,
				backlog,
				jobRunId: childJobId
			});

			if (decision.action !== 'idle') {
				const actionResult = await runDaemonAction(decision.action);
				hadFailure = actionResult.hadFailure;
				rateLimitResetAt = actionResult.rateLimitResetAt;
				if (childJobId !== null) {
					finishJobRun(
						childJobId,
						hadFailure ? 'failed' : 'success',
						actionResult.detail ?? {},
						hadFailure ? 'cycle reported failure or rate limit' : undefined,
						decision.reason
					);
				}
			}

			if (rateLimitResetAt) {
				rateLimitedUntil = rateLimitResetAt;
			} else if (!hadFailure) {
				rateLimitedUntil = null;
			}

			failureStreak = hadFailure ? failureStreak + 1 : 0;

			const backlogAfter = queryBacklogSnapshot({ rateLimitedUntil });
			const waitMs = computeDaemonSleepMs({
				backlog: backlogAfter,
				hadFailure,
				rateLimitResetAt,
				failureStreak,
				sleepMinMs: SLEEP_MIN_MS,
				sleepMaxMs: SLEEP_MAX_MS,
				backoffBaseMs: BACKOFF_BASE_MS,
				backoffMaxMs: BACKOFF_MAX_MS
			});

			sleepUntil = new Date(Date.now() + waitMs).toISOString();
			phase = hasAnyBacklog(backlogAfter) ? 'backlog-sleep' : 'sleeping';

			updateJobRun(daemonJobId, {
				pid: process.pid,
				phase,
				sleep_until: sleepUntil,
				sleep_ms: waitMs,
				failure_streak: failureStreak,
				last_action: decision.action,
				last_reason: decision.reason,
				backlog_after: backlogAfter,
				in_process: true
			});

			appendLog(`[daemon] sleeping ${waitMs}ms until ${sleepUntil} (${phase})`);
			if (!(await waitWithStop(waitMs))) break;
		} catch (err) {
			failureStreak++;
			const message = err instanceof Error ? err.message : String(err);
			appendLog(`[daemon] error: ${message}`);
			if (childJobId !== null) {
				finishJobRun(childJobId, 'failed', {}, message, decision.reason);
			}
			phase = 'error';
			const backlogAfter = queryBacklogSnapshot({ rateLimitedUntil });
			const waitMs = computeDaemonSleepMs({
				backlog: backlogAfter,
				hadFailure: true,
				failureStreak,
				sleepMinMs: SLEEP_MIN_MS,
				sleepMaxMs: SLEEP_MAX_MS,
				backoffBaseMs: BACKOFF_BASE_MS,
				backoffMaxMs: BACKOFF_MAX_MS
			});
			sleepUntil = new Date(Date.now() + waitMs).toISOString();
			updateJobRun(daemonJobId, {
				pid: process.pid,
				phase,
				error: message,
				failure_streak: failureStreak,
				sleep_until: sleepUntil,
				in_process: true
			});
			if (!(await waitWithStop(waitMs))) break;
		}
	}

	if (daemonJobId !== null) {
		finishJobRun(
			daemonJobId,
			stopRequested ? 'cancelled' : 'success',
			{ pid: process.pid, stopped_at: new Date().toISOString(), in_process: true },
			stopRequested ? 'stop requested' : undefined
		);
	}

	appendLog('[daemon] stopped');
	console.log('[daemon] stopped');
	running = false;
	loopPromise = null;
	daemonJobId = null;
	phase = 'stopped';
	sleepUntil = null;
	startedAt = null;
	rateLimitedUntil = null;
}

export function isBackgroundDaemonRunning(): boolean {
	return running;
}

export function getBackgroundDaemonState() {
	return {
		running,
		phase,
		sleepUntil,
		startedAt,
		pid: running ? process.pid : null,
		jobId: daemonJobId,
		failureStreak,
		rateLimitedUntil
	};
}

export function startBackgroundDaemon(): { started: boolean; message: string } {
	if (running) {
		return { started: false, message: 'Auto-scan is already running' };
	}
	running = true;
	stopRequested = false;
	loopPromise = runLoop().catch((err) => {
		console.error('[daemon] fatal:', err);
		running = false;
		loopPromise = null;
	});
	return { started: true, message: 'Auto-scan started' };
}

export function stopBackgroundDaemon(): { stopped: boolean; message: string } {
	if (!running) {
		return { stopped: false, message: 'Auto-scan is not running' };
	}
	stopRequested = true;
	return { stopped: true, message: 'Auto-scan stopping after current step…' };
}

let autoStartAttempted = false;
let orphanJobsReconciled = false;

function reconcileOrphanedJobsOnce(): void {
	if (orphanJobsReconciled) return;
	orphanJobsReconciled = true;
	const count = reconcileOrphanedJobRuns();
	if (count > 0) {
		console.log(`[daemon] reconciled ${count} orphaned job_run(s)`);
		appendLog(`[daemon] reconciled ${count} orphaned job_run(s)`);
	}
}

/** Start auto-scan on boot when BACKGROUND_WORKER=auto|1 (default auto on Railway). */
export function ensureBackgroundWorker(): void {
	if (autoStartAttempted) return;
	autoStartAttempted = true;

	reconcileOrphanedJobsOnce();
	const mode = process.env.BACKGROUND_WORKER ?? 'auto';
	const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
	const enabled =
		mode === '1' ||
		mode === 'true' ||
		(mode === 'auto' && onRailway);

	if (enabled && !running) {
		console.log('[daemon] auto-starting background worker');
		startBackgroundDaemon();
	}
}
