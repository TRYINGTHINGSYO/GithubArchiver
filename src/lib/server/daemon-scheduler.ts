import {
	ensureScheduledJobs,
	isJobDue,
	markJobCompleted,
	markJobFailed,
	markJobStarted,
	type ScheduledJobName
} from './db/scheduled-jobs.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const DAEMON_JOB_INTERVALS: Record<ScheduledJobName, number> = {
	ingest: Number(process.env.DAEMON_INGEST_INTERVAL_MS ?? 10 * MINUTE),
	/** Immediately re-check; enrich cycle itself drains the backlog. */
	enrich: Number(process.env.DAEMON_ENRICH_INTERVAL_MS ?? 5_000),
	refresh: Number(process.env.DAEMON_REFRESH_INTERVAL_MS ?? 6 * HOUR),
	classify: Number(process.env.DAEMON_CLASSIFY_INTERVAL_MS ?? 10 * MINUTE),
	clusters: Number(process.env.DAEMON_CLUSTERS_INTERVAL_MS ?? 30 * MINUTE),
	score: Number(process.env.DAEMON_SCORE_INTERVAL_MS ?? 30 * MINUTE),
	stories: Number(process.env.DAEMON_STORIES_INTERVAL_MS ?? 30 * MINUTE),
	emerging: Number(process.env.DAEMON_EMERGING_INTERVAL_MS ?? 3 * HOUR),
	discovery: Number(process.env.DAEMON_DISCOVERY_INTERVAL_MS ?? 1 * HOUR),
	archive: Number(process.env.DAEMON_ARCHIVE_INTERVAL_MS ?? 15 * MINUTE),
	deletionCheck: Number(process.env.DAEMON_DELETION_CHECK_INTERVAL_MS ?? 24 * HOUR),
	backup: Number(process.env.DAEMON_BACKUP_INTERVAL_MS ?? 24 * HOUR)
};

export const DAEMON_JOB_ORDER: ScheduledJobName[] = [
	'enrich',
	'classify',
	'clusters',
	'score',
	'stories',
	'discovery',
	'ingest',
	'refresh',
	'emerging',
	'archive',
	'deletionCheck',
	'backup'
];

export function initializeDaemonScheduler(): void {
	ensureScheduledJobs(DAEMON_JOB_ORDER);
}

/**
 * Prefer clearing the enrichment backlog before discovering more repositories.
 */
export function getDueDaemonJobs(
	now = Date.now(),
	opts: { unenrichedCount?: number } = {}
): ScheduledJobName[] {
	const due = DAEMON_JOB_ORDER.filter((jobName) => isJobDue(jobName, now));
	const unenriched = opts.unenrichedCount;
	if (unenriched != null && unenriched > 0) {
		return due.filter((jobName) => jobName !== 'ingest');
	}
	return due;
}

export async function runScheduledJob<T>(
	jobName: ScheduledJobName,
	fn: () => Promise<T>
): Promise<T> {
	markJobStarted(jobName);
	try {
		const result = await fn();
		markJobCompleted(jobName, DAEMON_JOB_INTERVALS[jobName]);
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		markJobFailed(jobName, message, DAEMON_JOB_INTERVALS[jobName]);
		throw err;
	}
}
