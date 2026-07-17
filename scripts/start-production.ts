import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const children: ReturnType<typeof spawn>[] = [];
let shuttingDown = false;

/**
 * Production launcher: web server + full discovery daemon in one process tree.
 * Disables the in-process BACKGROUND_WORKER so only scripts/daemon.ts owns the pipeline.
 */
function spawnWeb(): ReturnType<typeof spawn> {
	return spawn('node', ['build'], {
		stdio: 'inherit',
		env: {
			...process.env,
			BACKGROUND_WORKER: '0'
		}
	});
}

function spawnDaemon(): ReturnType<typeof spawn> {
	const localTsx = join(process.cwd(), 'node_modules', '.bin', 'tsx');
	if (existsSync(localTsx)) {
		return spawn(localTsx, ['scripts/daemon.ts'], {
			stdio: 'inherit',
			env: { ...process.env }
		});
	}
	return spawn('node', ['--import', 'tsx', 'scripts/daemon.ts'], {
		stdio: 'inherit',
		env: { ...process.env }
	});
}

children.push(spawnWeb());
children.push(spawnDaemon());

function shutdown(signal: NodeJS.Signals) {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const child of children) {
		child.kill(signal);
	}
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

for (const child of children) {
	child.on('exit', (code, signal) => {
		if (!shuttingDown) {
			shutdown('SIGTERM');
			process.exit(code ?? (signal ? 1 : 0));
		}
	});
}
