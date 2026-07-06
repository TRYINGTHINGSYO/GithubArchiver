import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { finishJobRun, startJobRun, updateJobRun } from './db/jobs';
import { runArchiveCycle } from './workers/archive';
import { runEnrichCycle } from './workers/enrich';
import { runIngestCycle } from './workers/ingest';
import { runRefreshCycle } from './workers/refresh';

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

function randomSleepMs(): number {
	if (SLEEP_MIN_MS >= SLEEP_MAX_MS) return SLEEP_MIN_MS;
	return SLEEP_MIN_MS + Math.floor(Math.random() * (SLEEP_MAX_MS - SLEEP_MIN_MS + 1));
}

function computeBackoffMs(): number {
	return Math.min(BACKOFF_BASE_MS * 2 ** failureStreak, BACKOFF_MAX_MS);
}

function rateLimitWaitMs(resetAt?: string): number {
	if (!resetAt) return computeBackoffMs();
	return Math.max(new Date(resetAt).getTime() - Date.now(), BACKOFF_BASE_MS);
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

async function runLoop(): Promise<void> {
	startedAt = new Date().toISOString();
	daemonJobId = startJobRun('daemon', {
		pid: process.pid,
		started_at: startedAt,
		phase: 'starting',
		in_process: true
	});

	appendLog(`daemon started in-process (pid ${process.pid})`);
	console.log(`[daemon] started in-process (pid ${process.pid})`);

	while (!stopRequested) {
		const loopStarted = new Date().toISOString();
		phase = 'ingest';
		sleepUntil = null;
		updateJobRun(daemonJobId, {
			pid: process.pid,
			started_at: startedAt,
			phase,
			loop_started: loopStarted,
			failure_streak: failureStreak,
			in_process: true
		});

		let hadFailure = false;
		let rateLimitResetAt: string | undefined;

		try {
			appendLog('[daemon] ingest…');
			const ingest = await runIngestCycle();
			appendLog(
				`[daemon] ingest: ${ingest.downloaded} downloaded, +${ingest.inserted} repos`
			);
			if (ingest.failed > 0 || ingest.unavailable > 0) hadFailure = true;

			if (stopRequested) break;

			phase = 'enrich';
			updateJobRun(daemonJobId, { phase, last_ingest: ingest, in_process: true });
			appendLog('[daemon] enrich…');
			const enrich = await runEnrichCycle();
			if (enrich.rateLimited) {
				hadFailure = true;
				rateLimitResetAt = enrich.rateLimitResetAt;
			}

			if (stopRequested) break;

			phase = 'refresh';
			updateJobRun(daemonJobId, { phase, last_enrich: enrich, in_process: true });
			appendLog('[daemon] refresh…');
			const refresh = await runRefreshCycle();
			if (refresh.rateLimited) {
				hadFailure = true;
				rateLimitResetAt = refresh.rateLimitResetAt;
			}

			if (stopRequested) break;

			phase = 'archive';
			updateJobRun(daemonJobId, { phase, last_refresh: refresh, in_process: true });
			appendLog('[daemon] archive…');
			const archive = await runArchiveCycle();
			if (archive.rateLimited) {
				hadFailure = true;
				rateLimitResetAt = archive.rateLimitResetAt;
			}

			failureStreak = hadFailure ? failureStreak + 1 : 0;
			const waitMs = hadFailure ? rateLimitWaitMs(rateLimitResetAt) : randomSleepMs();
			sleepUntil = new Date(Date.now() + waitMs).toISOString();
			phase = 'sleeping';

			updateJobRun(daemonJobId, {
				pid: process.pid,
				phase,
				sleep_until: sleepUntil,
				failure_streak: failureStreak,
				last_archive: archive,
				in_process: true
			});

			appendLog(`[daemon] sleeping until ${sleepUntil}`);
			if (!(await waitWithStop(waitMs))) break;
		} catch (err) {
			failureStreak++;
			const message = err instanceof Error ? err.message : String(err);
			appendLog(`[daemon] error: ${message}`);
			phase = 'error';
			const waitMs = computeBackoffMs();
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
		failureStreak
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

/** Start auto-scan on boot when BACKGROUND_WORKER=auto|1 (default auto on Railway). */
export function ensureBackgroundWorker(): void {
	if (autoStartAttempted) return;
	autoStartAttempted = true;

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
