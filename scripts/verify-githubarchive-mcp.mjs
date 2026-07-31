/**
 * One-shot stdio MCP verification harness (not imported by the app).
 * Speaks JSON-RPC line protocol expected by packages/githubarchive-mcp.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const dbPath = process.env.DATABASE_PATH ?? resolve(repoRoot, 'data', 'githubarchive.db');

async function main() {
	// Launch tsx via node — avoids npm stdout banners and Windows npx.cmd spawn issues.
	const tsxCli = resolve(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
	const entry = resolve(repoRoot, 'packages', 'githubarchive-mcp', 'src', 'index.ts');
	const child = spawn(process.execPath, [tsxCli, entry], {
		cwd: repoRoot,
		env: { ...process.env, DATABASE_PATH: dbPath },
		stdio: ['pipe', 'pipe', 'pipe']
	});

	const pending = new Map();
	let nextId = 1;
	const stderrChunks = [];

	child.stderr.on('data', (buf) => stderrChunks.push(String(buf)));

	const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
	rl.on('line', (line) => {
		if (!line.trim()) return;
		try {
			const msg = JSON.parse(line);
			const waiter = pending.get(Number(msg.id));
			if (waiter) {
				pending.delete(Number(msg.id));
				waiter.resolve(msg);
			}
		} catch (err) {
			console.error('bad line from MCP:', line.slice(0, 200), err);
		}
	});

	function call(method, params = {}) {
		const id = nextId++;
		const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
		return new Promise((resolvePromise, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`timeout waiting for ${method}`));
			}, 60_000);
			pending.set(id, {
				resolve: (v) => {
					clearTimeout(timer);
					resolvePromise(v);
				},
				reject
			});
			child.stdin.write(`${payload}\n`);
		});
	}

	const report = {
		dbPath,
		tools: [],
		resources: [],
		toolResults: {},
		stderr: '',
		ok: true,
		errors: []
	};

	try {
		const init = await call('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'verify-githubarchive-mcp', version: '0.0.1' }
		});
		if (init.error) throw new Error(init.error.message);
		report.initialize = init.result;

		await call('notifications/initialized', {});

		const toolsList = await call('tools/list');
		report.tools = (toolsList.result?.tools ?? []).map((t) => t.name);

		const resourcesList = await call('resources/list');
		report.resources = (resourcesList.result?.resources ?? []).map((r) => r.uri);

		const important = [
			['get_project_state', {}],
			['get_product_overview', {}],
			['list_features', {}],
			[
				'search_existing_capabilities',
				{ query: 'independent repository evidence grouping emerging topics' }
			],
			[
				'validate_proposed_change',
				{ proposal: 'Add independent repository evidence grouping to emerging topics.' }
			],
			['analyze_site', {}],
			['get_data_quality_report', {}],
			['query_repositories', { limit: 3 }],
			['inspect_repository', { owner: 'vercel', name: 'next.js' }],
			['explain_topic_detection', {}],
			['get_recent_commits', { limit: 12 }],
			['verify_read_only_enforcement', {}]
		];

		for (const [name, args] of important) {
			const res = await call('tools/call', { name, arguments: args });
			if (res.error) {
				report.errors.push(`${name}: ${res.error.message}`);
				report.ok = false;
				report.toolResults[name] = { error: res.error.message };
				continue;
			}
			const content = res.result?.content?.[0]?.text;
			let parsed = content;
			try {
				parsed = content ? JSON.parse(content) : res.result;
			} catch {
				parsed = content;
			}
			report.toolResults[name] = summarize(name, parsed);
		}
	} catch (err) {
		report.ok = false;
		report.errors.push(err instanceof Error ? err.message : String(err));
	} finally {
		report.stderr = stderrChunks.join('').slice(0, 2000);
		try {
			child.stdin.end();
		} catch {
			/* ignore */
		}
		child.kill();
	}

	console.log(JSON.stringify(report, null, 2));
	if (!report.ok) process.exitCode = 1;
}

function summarize(name, parsed) {
	if (!parsed || typeof parsed !== 'object') return parsed;
	const env = parsed;
	const data = env.data ?? parsed;

	if (name === 'validate_proposed_change') {
		return {
			alreadyExists: data.alreadyExists ?? data.exists ?? data.status ?? null,
			matchedFeature: data.matchedFeature ?? data.feature ?? data.matches ?? null,
			facts: pickList(data.facts ?? env.facts),
			inferences: pickList(data.inferences ?? env.inferences),
			recommendations: pickList(data.recommendations ?? env.recommendations),
			keys: Object.keys(data).slice(0, 40),
			preview: JSON.stringify(data).slice(0, 1200)
		};
	}
	if (name === 'analyze_site') {
		return {
			facts: pickList(data.facts ?? env.facts),
			inferences: pickList(data.inferences ?? env.inferences),
			recommendations: pickList(data.recommendations ?? env.recommendations),
			keys: Object.keys(data).slice(0, 40)
		};
	}
	if (name === 'get_recent_commits') {
		return {
			count: data.commits?.length ?? 0,
			subjects: (data.commits ?? []).slice(0, 12).map((c) => c.subject ?? c.message ?? c.hash)
		};
	}
	if (name === 'list_features') {
		const features = data.features ?? [];
		return {
			count: features.length,
			sampleIds: features.slice(0, 8).map((f) => f.id ?? f)
		};
	}
	if (name === 'query_repositories') {
		return { total: data.total, returned: data.items?.length ?? 0 };
	}
	if (name === 'verify_read_only_enforcement') {
		return data;
	}
	if (name === 'search_existing_capabilities') {
		return {
			keys: Object.keys(data).slice(0, 30),
			preview: JSON.stringify(data).slice(0, 1000)
		};
	}
	return {
		keys: Object.keys(data).slice(0, 40),
		preview: JSON.stringify(data).slice(0, 500)
	};
}

function pickList(value) {
	if (!Array.isArray(value)) return value ?? null;
	return value.slice(0, 5);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
