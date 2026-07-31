import {
	orphanJobAgeMs,
	reconcileOrphanedJobRunsDetailed,
	type ReconcileOrphansResult
} from './db/jobs.js';
import { ensureScheduledJobs, isJobDue, type ScheduledJobName } from './db/scheduled-jobs.js';
import { runScheduledJob } from './daemon-scheduler.js';
import {
	runDiscoveryMaterializationCycle,
	type DiscoveryMaterializationResult
} from './workers/discovery.js';
import { runHomepageReadinessMaterializationCycle } from './workers/homepage-readiness.js';
import { runEmergingTopicCycle, type EmergingCycleResult } from './workers/emerging.js';
import { runWebsiteCtDiscoverCycle } from './workers/website-ct.js';
import { runWebsiteVerifyCycle } from './workers/website-verify.js';
import { runWebsiteZoneDiscoverCycle } from './workers/website-zone.js';

/**
 * Cadenced jobs for the in-process daemon. These use `scheduled_jobs` intervals
 * and must NOT compete in the planner priority race with ingest/enrich.
 */
export const IN_PROCESS_CADENCE_JOBS: ScheduledJobName[] = [
	'emerging',
	'discovery',
	'homepage_readiness',
	'website_ct',
	'website_zone',
	'website_verify'
];

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
	detail?:
		| EmergingCycleResult
		| DiscoveryMaterializationResult
		| Awaited<ReturnType<typeof runHomepageReadinessMaterializationCycle>>
		| { error: string };
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

export async function maybeRunDueDiscoveryCycle(
	opts: {
		now?: number;
		shouldSkip?: () => boolean;
		log?: (line: string) => void;
	} = {}
): Promise<CadenceRunResult> {
	if (opts.shouldSkip?.()) return { ran: false, hadFailure: false };
	if (!isJobDue('discovery', opts.now ?? Date.now())) {
		return { ran: false, hadFailure: false };
	}

	opts.log?.('[daemon] cadence: discovery materialization due');
	try {
		const result = await runScheduledJob('discovery', () =>
			runDiscoveryMaterializationCycle({ owner: `cadence-${process.pid}` })
		);
		opts.log?.(
			`[daemon] discovery: ${result.status}` +
				(result.runId != null ? ` run=${result.runId}` : '') +
				` rows=${JSON.stringify(result.rowCounts)}`
		);
		return {
			ran: true,
			hadFailure: result.status === 'failed',
			detail: result as DiscoveryMaterializationResult
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		opts.log?.(`[daemon] discovery failed: ${message}`);
		return { ran: true, hadFailure: true, detail: { error: message } };
	}
}

export async function maybeRunDueHomepageReadinessCycle(
	opts: {
		now?: number;
		shouldSkip?: () => boolean;
		log?: (line: string) => void;
	} = {}
): Promise<CadenceRunResult> {
	if (opts.shouldSkip?.()) return { ran: false, hadFailure: false };
	if (!isJobDue('homepage_readiness', opts.now ?? Date.now())) {
		return { ran: false, hadFailure: false };
	}

	opts.log?.('[daemon] cadence: homepage readiness materialization due');
	try {
		const result = await runScheduledJob('homepage_readiness', () =>
			runHomepageReadinessMaterializationCycle({ owner: `cadence-${process.pid}` })
		);
		opts.log?.(
			`[daemon] homepage_readiness: ${result.status}` +
				(result.runId != null ? ` run=${result.runId}` : '') +
				` high_signal=${result.highSignalRows}/${result.highSignalCount}`
		);
		return {
			ran: true,
			hadFailure: result.status === 'failed',
			detail: result
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		opts.log?.(`[daemon] homepage_readiness failed: ${message}`);
		return { ran: true, hadFailure: true, detail: { error: message } };
	}
}

export interface WebsiteCadenceResult {
	ran: boolean;
	hadFailure: boolean;
	jobs: string[];
}

/**
 * Run due website discovery/verify jobs (own intervals). Failures do not throw —
 * each job finishes its own job_runs row; scheduled_jobs backoff still advances.
 */
export async function maybeRunDueWebsiteCycles(
	opts: {
		now?: number;
		shouldSkip?: () => boolean;
		log?: (line: string) => void;
	} = {}
): Promise<WebsiteCadenceResult> {
	if (opts.shouldSkip?.()) return { ran: false, hadFailure: false, jobs: [] };
	const now = opts.now ?? Date.now();
	const jobs: string[] = [];
	let hadFailure = false;

	if (isJobDue('website_ct', now)) {
		jobs.push('website_ct');
		opts.log?.('[daemon] cadence: website_ct due');
		try {
			const r = await runScheduledJob('website_ct', () => runWebsiteCtDiscoverCycle());
			opts.log?.(
				`[daemon] website_ct: +${r.inserted} new / ${r.updated} updated (tld=${r.tldsPolled.join(',')})`
			);
			if (r.errors.length) hadFailure = true;
		} catch (err) {
			hadFailure = true;
			opts.log?.(
				`[daemon] website_ct failed: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	if (opts.shouldSkip?.()) return { ran: jobs.length > 0, hadFailure, jobs };

	if (isJobDue('website_zone', now)) {
		jobs.push('website_zone');
		opts.log?.('[daemon] cadence: website_zone due');
		try {
			const r = await runScheduledJob('website_zone', () => runWebsiteZoneDiscoverCycle());
			opts.log?.(
				r.enabled
					? `[daemon] website_zone: +${r.inserted} new / ${r.updated} updated`
					: '[daemon] website_zone: skipped (WEBSITE_ZONE_FEED_URL unset)'
			);
			if (r.errors.length) hadFailure = true;
		} catch (err) {
			hadFailure = true;
			opts.log?.(
				`[daemon] website_zone failed: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	if (opts.shouldSkip?.()) return { ran: jobs.length > 0, hadFailure, jobs };

	if (isJobDue('website_verify', now)) {
		jobs.push('website_verify');
		opts.log?.('[daemon] cadence: website_verify due');
		try {
			const r = await runScheduledJob('website_verify', () => runWebsiteVerifyCycle());
			opts.log?.(
				`[daemon] website_verify: ${r.live} live / ${r.parked} parked / ${r.dead} dead / ${r.error} error (${r.planned} planned)`
			);
		} catch (err) {
			hadFailure = true;
			opts.log?.(
				`[daemon] website_verify failed: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	return { ran: jobs.length > 0, hadFailure, jobs };
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
