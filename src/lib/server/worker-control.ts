import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { platform } from 'node:os';
import { getLatestDaemonJob, parseJobDetail } from './db/jobs';

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

function waitMs(ms: number) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		// busy wait — startDaemon is synchronous
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
	if (isDaemonProcessRunning()) {
		throw new Error('Daemon is already running');
	}
	spawnScript('daemon', 'daemon');

	const deadline = Date.now() + 8000;
	while (Date.now() < deadline) {
		const pid = readPid();
		if (pid && isProcessAlive(pid)) {
			return { pid };
		}
		waitMs(200);
	}

	const pid = readPid();
	if (pid && isProcessAlive(pid)) return { pid };
	throw new Error('Daemon start requested but process did not register a PID within 8s — check worker log');
}

export function stopDaemon(): { stopped: boolean; message: string } {
	const pid = readPid();
	if (!pid) {
		return { stopped: false, message: 'No daemon PID file found' };
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
		waitMs(500);
		if (isProcessAlive(pid)) {
			try {
				process.kill(pid, 'SIGKILL');
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

export function runPipelineNow(): { pid: number } {
	return spawnScript('pipeline:once', 'pipeline');
}

export function runWorkerJob(script: string, extraEnv?: Record<string, string>): { pid: number } {
	return spawnScript(script, script, extraEnv);
}

export function getDaemonUiStatus() {
	const processRunning = isDaemonProcessRunning();
	const job = getLatestDaemonJob();
	const detail = job ? parseJobDetail(job) : null;
	const dbRunning =
		job?.status === 'running' &&
		Boolean(detail?.pid) &&
		Date.now() - new Date(job.started_at).getTime() < 30 * 60 * 1000;

	return {
		processRunning,
		running: processRunning || dbRunning,
		job,
		detail,
		lastRunAt: job?.finished_at ?? job?.started_at ?? null,
		nextRunAt: detail?.sleep_until ?? null,
		logTail: getWorkerLogTail(30)
	};
}
