import './load-env.js';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDb } from '../src/lib/server/db/index.js';
import { finishJobRun, startJobRun, updateJobRun } from '../src/lib/server/db/jobs.js';
import { runArchiveCycle } from '../src/lib/server/workers/archive.js';
import { runEnrichCycle } from '../src/lib/server/workers/enrich.js';
import { runIngestCycle } from '../src/lib/server/workers/ingest.js';
import { runRefreshCycle } from '../src/lib/server/workers/refresh.js';

const SLEEP_MIN_MS = Number(process.env.DAEMON_SLEEP_MIN_MS ?? 5 * 60 * 1000);
const SLEEP_MAX_MS = Number(process.env.DAEMON_SLEEP_MAX_MS ?? 15 * 60 * 1000);
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

function randomSleepMs(): number {
	if (SLEEP_MIN_MS >= SLEEP_MAX_MS) return SLEEP_MIN_MS;
	return SLEEP_MIN_MS + Math.floor(Math.random() * (SLEEP_MAX_MS - SLEEP_MIN_MS + 1));
}

function computeBackoffMs(): number {
	const ms = BACKOFF_BASE_MS * 2 ** failureStreak;
	return Math.min(ms, BACKOFF_MAX_MS);
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

async function runLoop(): Promise<void> {
	const startedAt = new Date().toISOString();
	daemonJobId = startJobRun('daemon', {
		pid: process.pid,
		started_at: startedAt,
		phase: 'starting'
	});

	console.log(`Daemon started (pid ${process.pid})`);
	if (!process.env.GITHUB_TOKEN) {
		console.warn('GITHUB_TOKEN not set — enrich/archive will hit low rate limits.');
	}

	while (!shuttingDown) {
		const loopStarted = new Date().toISOString();
		updateJobRun(daemonJobId, {
			pid: process.pid,
			started_at: startedAt,
			phase: 'ingest',
			loop_started: loopStarted,
			failure_streak: failureStreak
		});

		let hadFailure = false;
		let rateLimitResetAt: string | undefined;

		try {
			console.log('[daemon] ingest…');
			const ingest = await runIngestCycle();
			console.log(
				`  ${ingest.downloaded} downloaded, ${ingest.unavailable} unavailable, ${ingest.failed} failed, +${ingest.inserted} repos`
			);
			if (ingest.failed > 0 || ingest.unavailable > 0) {
				hadFailure = true;
				if (ingest.errors.length) console.warn(`  ${ingest.errors.join('; ')}`);
			}

			if (shuttingDown) break;

			updateJobRun(daemonJobId, {
				pid: process.pid,
				phase: 'enrich',
				last_ingest: ingest,
				loop_started: loopStarted
			});

			console.log('[daemon] enrich…');
			const enrich = await runEnrichCycle();
			console.log(`  ${enrich.enriched} enriched, ${enrich.failed} failed`);
			if (enrich.rateLimited) {
				hadFailure = true;
				rateLimitResetAt = enrich.rateLimitResetAt;
				console.warn(`  rate limited until ${rateLimitResetAt}`);
			}

			if (shuttingDown) break;

			updateJobRun(daemonJobId, {
				pid: process.pid,
				phase: 'refresh',
				last_enrich: enrich,
				loop_started: loopStarted
			});

			console.log('[daemon] refresh…');
			const refresh = await runRefreshCycle();
			console.log(`  ${refresh.refreshed} refreshed, ${refresh.metricsChanged} metric changes`);
			if (refresh.rateLimited) {
				hadFailure = true;
				rateLimitResetAt = refresh.rateLimitResetAt;
				console.warn(`  rate limited until ${rateLimitResetAt}`);
			}

			if (shuttingDown) break;

			updateJobRun(daemonJobId, {
				pid: process.pid,
				phase: 'archive',
				last_refresh: refresh,
				loop_started: loopStarted
			});

			console.log('[daemon] archive…');
			const archive = await runArchiveCycle();
			console.log(`  ${archive.saved} saved, ${archive.skipped} skipped, ${archive.issues} issues`);
			if (archive.rateLimited) {
				hadFailure = true;
				rateLimitResetAt = archive.rateLimitResetAt;
				console.warn(`  rate limited until ${rateLimitResetAt}`);
			}

			if (hadFailure) {
				failureStreak++;
			} else {
				failureStreak = 0;
			}

			const waitMs = hadFailure ? rateLimitWaitMs(rateLimitResetAt) : randomSleepMs();
			const wakeAt = new Date(Date.now() + waitMs).toISOString();

			updateJobRun(daemonJobId, {
				pid: process.pid,
				phase: 'sleeping',
				loop_started: loopStarted,
				sleep_until: wakeAt,
				failure_streak: failureStreak,
				last_archive: archive
			});

			console.log(
				hadFailure
					? `[daemon] backing off ${Math.round(waitMs / 1000)}s (streak ${failureStreak})…`
					: `[daemon] sleeping ${Math.round(waitMs / 1000)}s until ${wakeAt}…`
			);

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
	getDb(); // opens DB, runs migrations + drift repair, marks ready
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
