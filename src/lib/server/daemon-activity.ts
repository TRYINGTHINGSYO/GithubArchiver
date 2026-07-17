import { getBackgroundDaemonState } from '$lib/server/background-daemon';
import { hasAnyBacklog } from '$lib/server/daemon-planner';
import { queryBacklogSnapshot } from '$lib/server/daemon-backlog';
import { getRunningJobByType, getLatestDaemonJob, parseJobDetail } from '$lib/server/db/jobs';
import type { JobType } from '$lib/server/db/types';
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
	progress: null;
	nextCheckIn: string | null;
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

export function formatActivityMessage(action: ActivityAction, count: number | null, hasBacklog: boolean): string {
	switch (action) {
		case 'ingest':
			return 'Scanning GitHub for new repos...';
		case 'enrich':
			return count != null
				? `Reading READMEs and tagging ${count} repositories...`
				: 'Reading READMEs and tagging repositories...';
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
			return hasBacklog ? 'Waiting for next check...' : 'Caught up — waiting for new activity.';
	}
}

function plannedCount(action: string, detail: Record<string, unknown>): number | null {
	if (detail.planned != null && Number.isFinite(Number(detail.planned))) {
		return Number(detail.planned);
	}
	if (action === 'ingest' && detail.hours_planned != null) {
		return Number(detail.hours_planned);
	}
	return defaultBatchSize(action);
}

export function resolveDaemonActivity(input: DaemonActivityInput): DaemonActivity {
	const nowMs = input.nowMs ?? Date.now();
	const rateLimited =
		Boolean(input.rateLimitedUntil) && Date.parse(input.rateLimitedUntil!) > nowMs;

	if (rateLimited) {
		return {
			action: 'rate_limited',
			message: formatActivityMessage('rate_limited', null, input.hasBacklog),
			startedAt: null,
			progress: null,
			nextCheckIn: input.sleepUntil
		};
	}

	const activeWorker = input.runningWorkerJob;
	const activePhase =
		input.daemonRunning && input.phase && WORK_PHASES.has(input.phase) ? input.phase : null;

	if (activeWorker) {
		const action = workerJobToAction(activeWorker.jobType);
		const count = plannedCount(activeWorker.jobType, activeWorker.detail);
		return {
			action,
			message: formatActivityMessage(action, count, input.hasBacklog),
			startedAt: activeWorker.startedAt,
			progress: null,
			nextCheckIn: null
		};
	}

	if (activePhase) {
		const action = phaseToAction(activePhase);
		const count = defaultBatchSize(activePhase);
		const message =
			activePhase === 'backfill'
				? 'Catching up on historical data...'
				: formatActivityMessage(action, count, input.hasBacklog);
		return {
			action,
			message,
			startedAt: input.loopStartedAt,
			progress: null,
			nextCheckIn: null
		};
	}

	return {
		action: 'idle',
		message: formatActivityMessage('idle', null, input.hasBacklog),
		startedAt: null,
		progress: null,
		nextCheckIn: input.sleepUntil
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

	const rateLimitedUntil =
		bg.rateLimitedUntil ??
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
				: daemonJob?.started_at ?? null
	});
}
