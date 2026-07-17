import { getBackgroundDaemonState } from '$lib/server/background-daemon';
import { hasAnyBacklog } from '$lib/server/daemon-planner';
import { queryBacklogSnapshot } from '$lib/server/daemon-backlog';
import { getRunningJobByType, getLatestDaemonJob, parseJobDetail } from '$lib/server/db/jobs';
import type { JobType } from '$lib/server/db/types';
import {
	getEnrichmentProgress,
	type EnrichmentProgress
} from '$lib/server/enrichment-progress';
import { getDaemonUiStatus } from '$lib/server/worker-control';

const WORK_PHASES = new Set([
	'ingest',
	'search_gap',
	'backfill',
	'enrich',
	'refresh',
	'archive'
]);

const WORKER_JOB_TYPES: JobType[] = ['ingest', 'enrich', 'archive', 'refresh'];

export type ActivityAction = 'ingest' | 'enrich' | 'archive' | 'refresh' | 'idle' | 'rate_limited';

export interface DaemonActivity {
	action: ActivityAction;
	message: string;
	startedAt: string | null;
	progress: {
		completed: number;
		failed: number;
		remaining: number;
		total: number;
		currentRepo: string | null;
		enrichedTotal: number;
	} | null;
	nextCheckIn: string | null;
	enrichment: EnrichmentProgress;
}

export interface DaemonActivityInput {
	daemonRunning: boolean;
	phase: string | null;
	sleepUntil: string | null;
	rateLimitedUntil: string | null;
	hasBacklog: boolean;
	runningWorkerJob: {
		jobType: string;
		startedAt: string;
		detail: Record<string, unknown>;
	} | null;
	loopStartedAt: string | null;
	enrichment: EnrichmentProgress;
	nowMs?: number;
}

function defaultBatchSize(action: string): number | null {
	switch (action) {
		case 'enrich':
			return Number(process.env.ENRICH_BATCH_SIZE ?? 50);
		case 'refresh':
			return Number(process.env.REFRESH_BATCH_SIZE ?? 50);
		case 'archive':
			return Number(process.env.ARCHIVE_MAX_REPOS ?? 25);
		default:
			return null;
	}
}

function phaseToAction(phase: string): ActivityAction {
	switch (phase) {
		case 'enrich':
			return 'enrich';
		case 'archive':
			return 'archive';
		case 'refresh':
			return 'refresh';
		case 'ingest':
		case 'search_gap':
		case 'backfill':
			return 'ingest';
		default:
			return 'idle';
	}
}

function workerJobToAction(jobType: string): ActivityAction {
	switch (jobType) {
		case 'enrich':
			return 'enrich';
		case 'archive':
			return 'archive';
		case 'refresh':
			return 'refresh';
		case 'ingest':
			return 'ingest';
		default:
			return 'idle';
	}
}

function enrichMessage(progress: EnrichmentProgress): string {
	if (progress.status === 'rate_limited') {
		return 'Pausing briefly (GitHub rate limit)...';
	}
	if (progress.currentRepo) {
		return `Enriching ${progress.currentRepo} — ${progress.completed.toLocaleString()} done, ${progress.remaining.toLocaleString()} left`;
	}
	if (progress.remaining > 0) {
		return `Building repository intelligence — ${progress.enrichedTotal.toLocaleString()} done, ${progress.remaining.toLocaleString()} waiting`;
	}
	return 'Enrichment caught up — ready for new discoveries.';
}

/** True when the public status bar will show enrichment backlog counts. */
export function shouldSurfaceEnrichmentProgress(enrichment: EnrichmentProgress): boolean {
	return enrichment.remaining > 0 || Boolean(enrichment.currentRepo);
}

export function formatActivityMessage(
	action: ActivityAction,
	count: number | null,
	hasBacklog: boolean,
	enrichment?: EnrichmentProgress
): string {
	// Counts in the activity bar are enrichment totals whenever a backlog remains.
	// Prefer enrichment copy so the banner never says "Scanning GitHub..." next to those numbers.
	if (enrichment && shouldSurfaceEnrichmentProgress(enrichment) && action !== 'rate_limited') {
		if (action === 'enrich' || action === 'idle' || action === 'ingest') {
			return enrichMessage(enrichment);
		}
	}
	if (action === 'enrich' && enrichment) {
		return enrichMessage(enrichment);
	}
	switch (action) {
		case 'ingest':
			return 'Discovering repositories from the archive...';
		case 'enrich':
			return count != null
				? `Building repository intelligence — working through ${count.toLocaleString()}...`
				: 'Building repository intelligence...';
		case 'archive':
			return count != null
				? `Saving snapshots for ${count} repositories...`
				: 'Saving snapshots for repositories...';
		case 'refresh':
			return count != null
				? `Checking ${count} repositories for updates...`
				: 'Checking repositories for updates...';
		case 'rate_limited':
			return 'Pausing briefly (GitHub rate limit)...';
		case 'idle':
		default:
			if (enrichment && enrichment.remaining > 0) {
				return enrichMessage(enrichment);
			}
			return hasBacklog ? 'Waiting for next check...' : 'Caught up — waiting for new activity.';
	}
}

function plannedCount(action: string, detail: Record<string, unknown>): number | null {
	if (detail.planned != null && Number.isFinite(Number(detail.planned))) {
		return Number(detail.planned);
	}
	if (detail.remaining != null && Number.isFinite(Number(detail.remaining))) {
		return Number(detail.remaining);
	}
	if (action === 'ingest' && detail.hours_planned != null) {
		return Number(detail.hours_planned);
	}
	return defaultBatchSize(action);
}

function progressFromEnrichment(enrichment: EnrichmentProgress): DaemonActivity['progress'] {
	return {
		completed: enrichment.completed,
		failed: enrichment.failed,
		remaining: enrichment.remaining,
		total: enrichment.backlogTotal,
		currentRepo: enrichment.currentRepo,
		enrichedTotal: enrichment.enrichedTotal
	};
}

export function resolveDaemonActivity(input: DaemonActivityInput): DaemonActivity {
	const nowMs = input.nowMs ?? Date.now();
	const rateLimited =
		Boolean(input.rateLimitedUntil) && Date.parse(input.rateLimitedUntil!) > nowMs;

	if (rateLimited || input.enrichment.status === 'rate_limited') {
		return {
			action: 'rate_limited',
			message: formatActivityMessage('rate_limited', null, input.hasBacklog, input.enrichment),
			startedAt: null,
			progress: progressFromEnrichment(input.enrichment),
			nextCheckIn: input.sleepUntil ?? input.enrichment.rateLimitResetAt ?? null,
			enrichment: input.enrichment
		};
	}

	const activeWorker = input.runningWorkerJob;
	const activePhase =
		input.daemonRunning && input.phase && WORK_PHASES.has(input.phase) ? input.phase : null;

	if (activeWorker) {
		const workerAction = workerJobToAction(activeWorker.jobType);
		const count = plannedCount(activeWorker.jobType, activeWorker.detail);
		const currentFromJob =
			typeof activeWorker.detail.current_repo === 'string'
				? activeWorker.detail.current_repo
				: input.enrichment.currentRepo;
		const enrichment =
			workerAction === 'enrich'
				? {
						...input.enrichment,
						currentRepo: currentFromJob,
						completed:
							typeof activeWorker.detail.enriched === 'number'
								? activeWorker.detail.enriched
								: input.enrichment.completed,
						remaining:
							typeof activeWorker.detail.remaining === 'number'
								? activeWorker.detail.remaining
								: input.enrichment.remaining
					}
				: input.enrichment;
		// When the bar shows enrichment counts, surface enrich as the public action.
		const action =
			workerAction === 'ingest' && shouldSurfaceEnrichmentProgress(enrichment)
				? 'enrich'
				: workerAction;
		return {
			action,
			message: formatActivityMessage(action, count, input.hasBacklog, enrichment),
			startedAt: activeWorker.startedAt,
			progress: progressFromEnrichment(enrichment),
			nextCheckIn: null,
			enrichment
		};
	}

	if (activePhase) {
		const phaseAction = phaseToAction(activePhase);
		const count = defaultBatchSize(activePhase);
		const action =
			phaseAction === 'ingest' && shouldSurfaceEnrichmentProgress(input.enrichment)
				? 'enrich'
				: phaseAction;
		const message =
			activePhase === 'backfill' && !shouldSurfaceEnrichmentProgress(input.enrichment)
				? 'Catching up on historical data...'
				: formatActivityMessage(action, count, input.hasBacklog, input.enrichment);
		return {
			action,
			message,
			startedAt: input.loopStartedAt,
			progress: progressFromEnrichment(input.enrichment),
			nextCheckIn: null,
			enrichment: input.enrichment
		};
	}

	if (input.enrichment.remaining > 0) {
		return {
			action: 'enrich',
			message: enrichMessage(input.enrichment),
			startedAt: null,
			progress: progressFromEnrichment(input.enrichment),
			nextCheckIn: input.sleepUntil,
			enrichment: input.enrichment
		};
	}

	return {
		action: 'idle',
		message: formatActivityMessage('idle', null, input.hasBacklog, input.enrichment),
		startedAt: null,
		progress: progressFromEnrichment(input.enrichment),
		nextCheckIn: input.sleepUntil,
		enrichment: input.enrichment
	};
}

function findActiveWorkerJob() {
	for (const jobType of WORKER_JOB_TYPES) {
		const job = getRunningJobByType(jobType);
		if (job) return job;
	}
	return null;
}

export function getDaemonActivity(): DaemonActivity {
	const daemon = getDaemonUiStatus();
	const bg = getBackgroundDaemonState();
	const backlog = queryBacklogSnapshot({ rateLimitedUntil: bg.rateLimitedUntil });
	const daemonJob = getLatestDaemonJob();
	const daemonDetail = daemonJob ? parseJobDetail(daemonJob) : {};
	const workerJob = findActiveWorkerJob();
	const enrichment = getEnrichmentProgress();

	const rateLimitedUntil =
		bg.rateLimitedUntil ??
		enrichment.rateLimitResetAt ??
		(typeof daemonDetail.backlog_after === 'object' &&
		daemonDetail.backlog_after &&
		'rateLimitedUntil' in (daemonDetail.backlog_after as Record<string, unknown>)
			? ((daemonDetail.backlog_after as Record<string, unknown>).rateLimitedUntil as string | null)
			: null);

	return resolveDaemonActivity({
		daemonRunning: daemon.running,
		phase: bg.phase ?? (typeof daemonDetail.phase === 'string' ? daemonDetail.phase : null),
		sleepUntil: bg.sleepUntil ?? daemon.nextRunAt,
		rateLimitedUntil,
		hasBacklog: hasAnyBacklog(backlog),
		runningWorkerJob: workerJob
			? {
					jobType: workerJob.job_type,
					startedAt: workerJob.started_at,
					detail: parseJobDetail(workerJob)
				}
			: null,
		loopStartedAt:
			typeof daemonDetail.loop_started === 'string'
				? daemonDetail.loop_started
				: daemonJob?.started_at ?? null,
		enrichment
	});
}
