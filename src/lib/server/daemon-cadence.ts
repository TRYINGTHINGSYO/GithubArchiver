import { ensureScheduledJobs, isJobDue, type ScheduledJobName } from './db/scheduled-jobs.js';
import { runScheduledJob } from './daemon-scheduler.js';
import { runEmergingTopicCycle, type EmergingCycleResult } from './workers/emerging.js';

/**
 * Cadenced jobs for the in-process daemon. These use `scheduled_jobs` intervals
 * (e.g. DAEMON_EMERGING_INTERVAL_MS, default 3h) and must NOT compete in the
 * planner priority race with ingest/enrich.
 */
export const IN_PROCESS_CADENCE_JOBS: ScheduledJobName[] = ['emerging'];

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
