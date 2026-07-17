import './load-env.js';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
	DAEMON_JOB_INTERVALS,
	DAEMON_JOB_ORDER,
	getDueDaemonJobs,
	initializeDaemonScheduler,
	runScheduledJob
} from '../src/lib/server/daemon-scheduler.js';
import { getDb } from '../src/lib/server/db/index.js';
import { finishJobRun, startJobRun, updateJobRun } from '../src/lib/server/db/jobs.js';
import { updateDiscoverySystemStatus } from '../src/lib/server/discovery-materialized.js';
import { runArchiveCycle } from '../src/lib/server/workers/archive.js';
import { runBackupCycle } from '../src/lib/server/workers/backup.js';
import { runClassifyCycle } from '../src/lib/server/workers/classify.js';
import { runClusterCycle } from '../src/lib/server/workers/cluster.js';
import { runDiscoveryMaterializationCycle } from '../src/lib/server/workers/discovery.js';
import { runEmergingTopicCycle } from '../src/lib/server/workers/emerging.js';
import { runEnrichCycle } from '../src/lib/server/workers/enrich.js';
import { runIngestCycle } from '../src/lib/server/workers/ingest.js';
import { runRefreshCycle } from '../src/lib/server/workers/refresh.js';
import { runScoreCycle } from '../src/lib/server/workers/score.js';
import { runArchiveStoryCycle } from '../src/lib/server/workers/stories.js';

const LOOP_INTERVAL_MS = Number(process.env.DAEMON_LOOP_INTERVAL_MS ?? 30_000);
const BACKOFF_BASE_MS = Number(process.env.DAEMON_BACKOFF_BASE_MS ?? 60_000);
const BACKOFF_MAX_MS = Number(process.env.DAEMON_BACKOFF_MAX_MS ?? 15 * 60 * 1000);

const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
const PID_FILE = join(DATA_DIR, 'daemon.pid');

function writePidFile() {
	mkdirSync(DATA_DIR, { recursive: true });
	writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

function removePidFile() {
	try {
		if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
	} catch {
		// ignore
	}
}

let shuttingDown = false;
let daemonJobId: number | null = null;
let failureStreak = 0;

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

function computeBackoffMs(): number {
	return Math.min(BACKOFF_BASE_MS * 2 ** failureStreak, BACKOFF_MAX_MS);
}

async function waitWithShutdown(ms: number): Promise<boolean> {
	const step = 1000;
	let remaining = ms;
	while (remaining > 0 && !shuttingDown) {
		const chunk = Math.min(step, remaining);
		await sleep(chunk);
		remaining -= chunk;
	}
	return !shuttingDown;
}

function rateLimitWaitMs(resetAt?: string): number {
	if (!resetAt) return computeBackoffMs();
	const until = new Date(resetAt).getTime() - Date.now();
	return Math.max(until, BACKOFF_BASE_MS);
}

async function runJob(jobName: (typeof DAEMON_JOB_ORDER)[number]): Promise<void> {
	switch (jobName) {
		case 'ingest': {
			const ingest = await runScheduledJob('ingest', () => runIngestCycle());
			console.log(
				`[daemon] ingest: ${ingest.downloaded} downloaded, +${ingest.inserted} repos`
			);
			break;
		}
		case 'enrich': {
			const enrich = await runScheduledJob('enrich', () => runEnrichCycle());
			console.log(`[daemon] enrich: ${enrich.enriched} enriched, ${enrich.failed} failed`);
			if (enrich.rateLimited) {
				throw Object.assign(new Error('GitHub rate limit during enrich'), {
					rateLimitResetAt: enrich.rateLimitResetAt
				});
			}
			break;
		}
		case 'refresh': {
			const refresh = await runScheduledJob('refresh', () => runRefreshCycle());
			console.log(`[daemon] refresh: ${refresh.refreshed} refreshed`);
			if (refresh.rateLimited) {
				throw Object.assign(new Error('GitHub rate limit during refresh'), {
					rateLimitResetAt: refresh.rateLimitResetAt
				});
			}
			break;
		}
		case 'classify': {
			const classify = await runScheduledJob('classify', () => runClassifyCycle());
			console.log(`[daemon] classify: ${classify.processed} repositories`);
			break;
		}
		case 'clusters': {
			const clusters = await runScheduledJob('clusters', () => runClusterCycle());
			console.log(`[daemon] clusters: ${clusters.processed} repositories`);
			break;
		}
		case 'score': {
			const score = await runScheduledJob('score', () => runScoreCycle());
			console.log(`[daemon] score: ${score.scored} re-scored`);
			break;
		}
		case 'stories': {
			const stories = await runScheduledJob('stories', () => runArchiveStoryCycle());
			console.log(`[daemon] stories: ${stories.processed} generated`);
			break;
		}
		case 'emerging': {
			const emerging = await runScheduledJob('emerging', () => runEmergingTopicCycle());
			console.log(`[daemon] emerging: ${emerging.saved} topics saved`);
			break;
		}
		case 'discovery': {
			const discovery = await runScheduledJob('discovery', () =>
				runDiscoveryMaterializationCycle()
			);
			console.log(
				`[daemon] discovery: ${discovery.qualified} qualified, ${discovery.preliminary} preliminary`
			);
			break;
		}
		case 'archive': {
			const archive = await runScheduledJob('archive', () => runArchiveCycle());
			console.log(`[daemon] archive: ${archive.saved} saved`);
			if (archive.rateLimited) {
				throw Object.assign(new Error('GitHub rate limit during archive'), {
					rateLimitResetAt: archive.rateLimitResetAt
				});
			}
			break;
		}
		case 'deletionCheck': {
			const deletion = await runScheduledJob('deletionCheck', () => runRefreshCycle());
			console.log(`[daemon] deletion check: ${deletion.refreshed} repos re-checked`);
			break;
		}
		case 'backup': {
			const backup = await runScheduledJob('backup', () => runBackupCycle());
			console.log(`[daemon] backup: ${backup?.path ?? 'skipped'}`);
			break;
		}
	}
}

async function runLoop(): Promise<void> {
	const startedAt = new Date().toISOString();
	daemonJobId = startJobRun('daemon', {
		pid: process.pid,
		started_at: startedAt,
		phase: 'starting',
		scheduler: DAEMON_JOB_INTERVALS
	});

	console.log(`Daemon started (pid ${process.pid})`);
	if (!process.env.GITHUB_TOKEN) {
		console.warn('GITHUB_TOKEN not set — enrich/archive will hit low rate limits.');
	}

	initializeDaemonScheduler();
	updateDiscoverySystemStatus('running');

	while (!shuttingDown) {
		const loopStarted = new Date().toISOString();
		updateJobRun(daemonJobId, {
			pid: process.pid,
			phase: 'scheduling',
			loop_started: loopStarted,
			failure_streak: failureStreak
		});

		const dueJobs = getDueDaemonJobs();
		let hadFailure = false;
		let rateLimitResetAt: string | undefined;

		try {
			for (const jobName of dueJobs) {
				if (shuttingDown) break;
				updateJobRun(daemonJobId, { pid: process.pid, phase: jobName, loop_started: loopStarted });
				try {
					await runJob(jobName);
				} catch (err) {
					hadFailure = true;
					const message = err instanceof Error ? err.message : String(err);
					console.warn(`[daemon] ${jobName} failed:`, message);
					if (err && typeof err === 'object' && 'rateLimitResetAt' in err) {
						rateLimitResetAt = String((err as { rateLimitResetAt?: string }).rateLimitResetAt);
					}
				}
			}

			if (hadFailure) failureStreak++;
			else failureStreak = 0;

			const waitMs = hadFailure ? rateLimitWaitMs(rateLimitResetAt) : LOOP_INTERVAL_MS;
			const wakeAt = new Date(Date.now() + waitMs).toISOString();
			updateJobRun(daemonJobId, {
				pid: process.pid,
				phase: 'sleeping',
				loop_started: loopStarted,
				sleep_until: wakeAt,
				failure_streak: failureStreak,
				due_next_loop: dueJobs
			});

			if (!(await waitWithShutdown(waitMs))) break;
		} catch (err) {
			failureStreak++;
			const message = err instanceof Error ? err.message : String(err);
			console.error('[daemon] loop error:', message);
			const waitMs = computeBackoffMs();
			updateJobRun(daemonJobId, {
				pid: process.pid,
				phase: 'error',
				error: message,
				failure_streak: failureStreak,
				sleep_until: new Date(Date.now() + waitMs).toISOString()
			});
			if (!(await waitWithShutdown(waitMs))) break;
		}
	}

	updateDiscoverySystemStatus('idle');
	if (daemonJobId !== null) {
		finishJobRun(
			daemonJobId,
			shuttingDown ? 'cancelled' : 'success',
			{ pid: process.pid, stopped_at: new Date().toISOString() },
			shuttingDown ? 'shutdown requested' : undefined
		);
	}

	console.log('Daemon stopped.');
	removePidFile();
}

function shutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`\n${signal} received — finishing current work and exiting…`);
}

async function main() {
	getDb();
	writePidFile();
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('exit', () => removePidFile());
	await runLoop();
}

main().catch((err) => {
	console.error(err);
	if (daemonJobId !== null) {
		finishJobRun(
			daemonJobId,
			'failed',
			{ pid: process.pid },
			err instanceof Error ? err.message : String(err)
		);
	}
	process.exit(1);
});
