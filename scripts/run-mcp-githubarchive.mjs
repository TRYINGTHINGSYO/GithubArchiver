/**
 * Cursor launches this file for the GithubArchive+ MCP server.
 * Prefer this over `npm run` because npm prints lifecycle banners to stdout
 * and breaks the MCP JSON-RPC stdio protocol.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const tsxCli = resolve(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = resolve(repoRoot, 'packages', 'githubarchive-mcp', 'src', 'index.ts');

const child = spawn(process.execPath, [tsxCli, entry], {
	cwd: repoRoot,
	env: process.env,
	stdio: 'inherit'
});

child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	process.exit(code ?? 1);
});
