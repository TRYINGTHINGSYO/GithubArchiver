import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { platform } from 'node:os';
import { getLatestDaemonJob, parseJobDetail } from './db/jobs';
import {
	getBackgroundDaemonState,
	isBackgroundDaemonRunning,
	startBackgroundDaemon,
	stopBackgroundDaemon
} from './background-daemon';
import { getCurrentJobLabel, isJobRunnerBusy } from './job-runner';

const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
const PID_FILE = join(DATA_DIR, 'daemon.pid');
const LOG_FILE = join(DATA_DIR, 'worker.log');
const PROJECT_ROOT = resolve('.');

const SCRIPT_PATHS: Record<string, string> = {
	daemon: 'scripts/daemon.ts',
	'pipeline:once': 'scripts/run-pipeline.ts',
	'ingest:hour': 'scripts/ingest-hour.ts',
	'enrich:repos': 'scripts/enrich-repos.ts',
	'archive:repos': 'scripts/archive-repos.ts',
	'enrich:refresh': 'scripts/enrich-refresh.ts',
	'backfill:resume': 'scripts/backfill-resume.ts'
};

function ensureDataDir() {
	mkdirSync(DATA_DIR, { recursive: true });
}

function readPid(): number | null {
	if (!existsSync(PID_FILE)) return null;
	const raw = readFileSync(PID_FILE, 'utf8').trim();
	const pid = Number(raw);
	return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function tsxCommand(): { command: string; args: string[]; shell: boolean } {
	const binName = platform() === 'win32' ? 'tsx.cmd' : 'tsx';
	const localTsx = join(PROJECT_ROOT, 'node_modules', '.bin', binName);
	if (existsSync(localTsx)) {
		return { command: localTsx, args: [], shell: false };
	}
	return { command: platform() === 'win32' ? 'npx.cmd' : 'npx', args: ['tsx'], shell: false };
}

export function isDaemonProcessRunning(): boolean {
	const pid = readPid();
	if (!pid) return false;
	if (!isProcessAlive(pid)) {
		rmSync(PID_FILE, { force: true });
		return false;
	}
	return true;
}

export function getWorkerLogTail(lines = 40): string[] {
	if (!existsSync(LOG_FILE)) return [];
	const content = readFileSync(LOG_FILE, 'utf8');
	return content.split(/\r?\n/).filter(Boolean).slice(-lines);
}

function spawnScript(
	scriptKey: string,
	label: string,
	extraEnv?: Record<string, string>
): { pid: number } {
	const relativePath = SCRIPT_PATHS[scriptKey];
	if (!relativePath) {
		throw new Error(`Unknown worker script: ${scriptKey}`);
	}

	ensureDataDir();
	const logFd = openSync(LOG_FILE, 'a');
	const stamp = new Date().toISOString();
	writeFileSync(logFd, `\n[${stamp}] starting ${label}\n`);

	const tsx = tsxCommand();
	const scriptPath = join(PROJECT_ROOT, relativePath);
	const args = [...tsx.args, scriptPath];

	const child = spawn(tsx.command, args, {
		cwd: PROJECT_ROOT,
		detached: true,
		stdio: ['ignore', logFd, logFd],
		shell: tsx.shell,
		windowsHide: true,
		env: { ...process.env, ...extraEnv }
	});
	child.unref();
	return { pid: child.pid ?? 0 };
}

export function startDaemon(): { pid: number } {
	if (isBackgroundDaemonRunning()) {
		throw new Error('Auto-scan is already running');
	}
	if (isDaemonProcessRunning()) {
		throw new Error('External daemon is already running');
	}
	const result = startBackgroundDaemon();
	if (!result.started) {
		throw new Error(result.message);
	}
	return { pid: process.pid };
}

export function stopDaemon(): { stopped: boolean; message: string } {
	if (isBackgroundDaemonRunning()) {
		return stopBackgroundDaemon();
	}
	return stopDaemonProcess();
}

function stopDaemonProcess(): { stopped: boolean; message: string } {
	const pid = readPid();
	if (!pid) {
		return { stopped: false, message: 'Auto-scan is not running' };
	}
	if (!isProcessAlive(pid)) {
		rmSync(PID_FILE, { force: true });
		return { stopped: false, message: 'Daemon process not running (stale PID removed)' };
	}

	if (platform() === 'win32') {
		spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
	} else {
		try {
			process.kill(-pid, 'SIGTERM');
		} catch {
			try {
				process.kill(pid, 'SIGTERM');
			} catch {
				// ignore
			}
		}
	}

	rmSync(PID_FILE, { force: true });
	const stillRunning = isProcessAlive(pid);
	return stillRunning
		? { stopped: false, message: `Failed to stop daemon pid ${pid}` }
		: { stopped: true, message: `Stopped daemon pid ${pid}` };
}

/** Legacy spawn path — prefer job-runner from admin API. */
export function runPipelineNow(): { pid: number } {
	return spawnScript('pipeline:once', 'pipeline');
}

/** Legacy spawn path — prefer job-runner from admin API. */
export function runWorkerJob(script: string, extraEnv?: Record<string, string>): { pid: number } {
	return spawnScript(script, script, extraEnv);
}

export function getDaemonUiStatus() {
	const bgRunning = isBackgroundDaemonRunning();
	const bgState = getBackgroundDaemonState();
	const processRunning = isDaemonProcessRunning() || bgRunning;
	const job = getLatestDaemonJob();
	const detail = job ? parseJobDetail(job) : null;
	const dbRunning =
		job?.status === 'running' &&
		Boolean(detail?.pid) &&
		Date.now() - new Date(job.started_at).getTime() < 30 * 60 * 1000;

	return {
		processRunning,
		running: processRunning || dbRunning,
		inProcess: bgRunning,
		phase: bgState.phase,
		job,
		detail,
		lastRunAt: job?.finished_at ?? job?.started_at ?? null,
		nextRunAt: bgState.sleepUntil ?? (detail?.sleep_until as string | undefined) ?? null,
		logTail: getWorkerLogTail(30),
		jobRunnerBusy: isJobRunnerBusy(),
		currentJob: getCurrentJobLabel()
	};
}
