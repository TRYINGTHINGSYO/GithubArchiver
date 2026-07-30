import {
	orphanJobAgeMs,
	reconcileOrphanedJobRunsDetailed,
	type ReconcileOrphansResult
} from './db/jobs.js';
import { ensureScheduledJobs, isJobDue, type ScheduledJobName } from './db/scheduled-jobs.js';
import { runScheduledJob } from './daemon-scheduler.js';
import { runEmergingTopicCycle, type EmergingCycleResult } from './workers/emerging.js';

/**
 * Cadenced jobs for the in-process daemon. These use `scheduled_jobs` intervals
 * (e.g. DAEMON_EMERGING_INTERVAL_MS, default 3h) and must NOT compete in the
 * planner priority race with ingest/enrich.
 */
export const IN_PROCESS_CADENCE_JOBS: ScheduledJobName[] = ['emerging'];

/** How often the orphan safety-net may run (default 2 min). */
export function reconcileCadenceIntervalMs(): number {
	const n = Number(process.env.DAEMON_RECONCILE_INTERVAL_MS ?? 2 * 60_000);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2 * 60_000;
}

let lastReconcileAt = 0;

/** Test hook — reset cadence timers between cases. */
export function resetDaemonCadenceForTests(): void {
	lastReconcileAt = 0;
}

export function initializeInProcessCadence(): void {
	ensureScheduledJobs(IN_PROCESS_CADENCE_JOBS);
}

export interface CadenceRunResult {
	ran: boolean;
	hadFailure: boolean;
	detail?: EmergingCycleResult | { error: string };
}

/**
 * If emerging is due, run it once via the shared scheduler (gates + detection
 * unchanged). After success/failure, `next_run_at` advances so a never-run
 * row cannot re-grab every planner loop.
 */
export async function maybeRunDueEmergingCycle(
	opts: {
		now?: number;
		shouldSkip?: () => boolean;
		log?: (line: string) => void;
	} = {}
): Promise<CadenceRunResult> {
	if (opts.shouldSkip?.()) return { ran: false, hadFailure: false };
	if (!isJobDue('emerging', opts.now ?? Date.now())) {
		return { ran: false, hadFailure: false };
	}

	opts.log?.('[daemon] cadence: emerging due');
	try {
		const result = await runScheduledJob('emerging', () => runEmergingTopicCycle());
		opts.log?.(
			`[daemon] emerging: ${result.saved} saved / ${result.candidates} candidates` +
				(result.comparable ? '' : ' (not comparable)')
		);
		return { ran: true, hadFailure: false, detail: result };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		opts.log?.(`[daemon] emerging failed: ${message}`);
		return { ran: true, hadFailure: true, detail: { error: message } };
	}
}

export interface ReconcileCadenceResult {
	ran: boolean;
	reconciled: number;
	ids: number[];
}

/**
 * Independent safety net: force-interrupt any `running` job_run past the hard
 * ceiling, even if that job type's own timeout never fired. Does not trust
 * ingest/enrich internals. Excludes the live daemon row so we don't kill ourselves.
 */
export function maybeReconcileStaleJobRuns(
	opts: {
		now?: number;
		excludeIds?: number[];
		/** Override ceiling (tests). Default orphanJobAgeMs(). */
		maxAgeMs?: number;
		/** Force run even if interval not elapsed (tests). */
		force?: boolean;
		log?: (line: string) => void;
	} = {}
): ReconcileCadenceResult {
	const now = opts.now ?? Date.now();
	if (!opts.force && now - lastReconcileAt < reconcileCadenceIntervalMs()) {
		return { ran: false, reconciled: 0, ids: [] };
	}
	lastReconcileAt = now;

	const result: ReconcileOrphansResult = reconcileOrphanedJobRunsDetailed(
		opts.maxAgeMs ?? orphanJobAgeMs(),
		now,
		{
			excludeIds: opts.excludeIds,
			reason: 'orphaned: exceeded running ceiling (periodic reconcile)',
			alert: true
		}
	);

	if (result.count > 0) {
		const line =
			`[daemon] SAFETY NET: reconciled ${result.count} stuck job_run(s) ` +
			`ids=[${result.ids.join(', ')}]`;
		opts.log?.(line);
		// alert:true already console.error'd inside reconcile; mirror to worker.log via log()
	}

	return { ran: true, reconciled: result.count, ids: result.ids };
}
