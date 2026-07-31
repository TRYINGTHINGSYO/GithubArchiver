/**
 * Measurement-only concurrency curve for GitHub metadata HTTP.
 *
 * Does NOT change daemon enrich concurrency, timeouts, pacing, or selection.
 * Runs controlled fetch batches at concurrency 1/2/4/8/12 and reports:
 *   throughput, TTFB, body read, queue wait, errors, connection reuse,
 *   DNS/TLS counts, event-loop delay, CPU/memory.
 *
 *   npx tsx scripts/measure-github-concurrency-curve.ts [--samples 36] [--db path]
 *
 * Prefer running inside the production container so networking matches enrich.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';
import {
	installGithubConnTrace,
	nearestRankPercentile
} from '../src/lib/server/github-conn-trace.js';

const LEVELS = [1, 2, 4, 8, 12] as const;
const GITHUB_API = 'https://api.github.com';

function argValue(flag: string): string | undefined {
	const idx = process.argv.indexOf(flag);
	if (idx < 0 || idx + 1 >= process.argv.length) return undefined;
	return process.argv[idx + 1];
}

function resolveDbPath(): string {
	const explicit = argValue('--db') ?? process.env.DATABASE_PATH;
	if (explicit) return explicit;
	for (const candidate of ['/data/githubarchive.db', './data/githubarchive.db']) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error('no database found; pass --db or set DATABASE_PATH');
}

function githubHeaders(): Record<string, string> {
	const h: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'GithubArchivePlus/0.3-concurrency-probe',
		'X-GitHub-Api-Version': '2022-11-28'
	};
	const token = process.env.GITHUB_TOKEN?.trim();
	if (token) h.Authorization = `Bearer ${token}`;
	return h;
}

async function mapPool<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, ctx: { queueWaitMs: number }) => Promise<R>
): Promise<R[]> {
	const batchEnqueuedAt = performance.now();
	const results: R[] = new Array(items.length);
	let next = 0;
	async function worker() {
		for (;;) {
			const idx = next++;
			if (idx >= items.length) return;
			const queueWaitMs = Math.max(0, Math.round(performance.now() - batchEnqueuedAt));
			results[idx] = await fn(items[idx], { queueWaitMs });
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
	);
	return results;
}

interface RepoRef {
	owner: string;
	name: string;
	full_name: string;
}

interface RequestSample {
	ok: boolean;
	status: number;
	queueWaitMs: number;
	httpConnectTtfbMs: number;
	bodyReadMs: number;
	parseMs: number;
	bodyBytes: number;
	dnsMs: number;
	tcpConnectMs: number;
	tlsMs: number;
	/** TTFB minus dns/tcp/tls — undici pool wait + server think time + event-loop deferral. */
	socketQueueOrServerMs: number;
	newTlsSocket: boolean;
	error?: string;
	rateLimitRemaining: string | null;
	rateLimitReset: string | null;
	retryAfter: string | null;
	xGithubRequestId: string | null;
	server: string | null;
}

interface LevelResult {
	concurrency: number;
	sampleCount: number;
	okCount: number;
	errorCount: number;
	retryLikeCount: number;
	elapsedMs: number;
	throughputPerMin: number;
	queueWait: { p50: number; p95: number; n: number };
	httpConnectTtfb: { p50: number; p95: number; n: number };
	bodyRead: { p50: number; p95: number; n: number };
	bodyBytes: { p50: number; p95: number; n: number };
	dns: { p50: number; p95: number; n: number };
	tcpConnect: { p50: number; p95: number; n: number };
	tls: { p50: number; p95: number; n: number };
	socketQueueOrServer: { p50: number; p95: number; n: number };
	newTlsSocketRate: number;
	dnsLookups: number;
	tcpConnects: number;
	tlsConnects: number;
	undiciRequests: number;
	undiciClientConnected: number;
	undiciConnectErrors: number;
	/** 0..1 inferred from undici connected/request; null if undici channels silent. */
	socketReuseRate: number | null;
	activeSocketsEnd: number;
	eventLoop: { meanMs: number; p50Ms: number; p95Ms: number; maxMs: number };
	cpuUserMs: number;
	cpuSystemMs: number;
	rssMb: number;
	heapUsedMb: number;
	headerSummary: {
		rateLimitRemainingMin: number | null;
		retryAfterSeen: number;
		statuses: Record<string, number>;
	};
}

function pair(values: number[]): { p50: number; p95: number; n: number } {
	return {
		p50: Math.round(nearestRankPercentile(values, 50) * 10) / 10,
		p95: Math.round(nearestRankPercentile(values, 95) * 10) / 10,
		n: values.length
	};
}

async function fetchRepoSample(
	ref: RepoRef,
	queueWaitMs: number,
	trace: ReturnType<typeof installGithubConnTrace>
): Promise<RequestSample> {
	const path = `/repos/${ref.owner}/${ref.name}`;
	const { result, spans } = await trace.runWithConnSpans(async () => {
		const ttfbStarted = performance.now();
		try {
			const res = await fetch(`${GITHUB_API}${path}`, { headers: githubHeaders() });
			const httpConnectTtfbMs = Math.max(0, Math.round(performance.now() - ttfbStarted));
			const bodyStarted = performance.now();
			const buf = Buffer.from(await res.arrayBuffer());
			const bodyReadMs = Math.max(0, Math.round(performance.now() - bodyStarted));
			const parseStarted = performance.now();
			if (res.ok) JSON.parse(buf.toString('utf8'));
			const parseMs = Math.max(0, Math.round(performance.now() - parseStarted));
			return {
				ok: res.ok,
				status: res.status,
				queueWaitMs,
				httpConnectTtfbMs,
				bodyReadMs,
				parseMs: res.ok ? parseMs : 0,
				bodyBytes: buf.byteLength,
				error: res.ok ? undefined : `HTTP ${res.status}`,
				rateLimitRemaining: res.headers.get('x-ratelimit-remaining'),
				rateLimitReset: res.headers.get('x-ratelimit-reset'),
				retryAfter: res.headers.get('retry-after'),
				xGithubRequestId: res.headers.get('x-github-request-id'),
				server: res.headers.get('server')
			};
		} catch (err) {
			return {
				ok: false,
				status: 0,
				queueWaitMs,
				httpConnectTtfbMs: Math.max(0, Math.round(performance.now() - ttfbStarted)),
				bodyReadMs: 0,
				parseMs: 0,
				bodyBytes: 0,
				error: err instanceof Error ? err.message : String(err),
				rateLimitRemaining: null,
				rateLimitReset: null,
				retryAfter: null,
				xGithubRequestId: null,
				server: null
			};
		}
	});

	const dnsMs = Math.round(spans.dnsMs);
	const tcpConnectMs = Math.round(spans.tcpConnectMs);
	const tlsMs = Math.round(spans.tlsMs);
	const socketQueueOrServerMs = Math.max(
		0,
		result.httpConnectTtfbMs - dnsMs - tcpConnectMs - tlsMs
	);

	return {
		...result,
		dnsMs,
		tcpConnectMs,
		tlsMs,
		socketQueueOrServerMs,
		newTlsSocket: spans.newTlsSocket
	};
}

function loadRepos(dbPath: string, count: number): RepoRef[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		const rows = db
			.prepare(
				`SELECT owner, name, full_name
				 FROM repos
				 WHERE deleted_at IS NULL
				   AND owner IS NOT NULL
				   AND name IS NOT NULL
				 ORDER BY enrichment_priority DESC, interesting_score DESC
				 LIMIT ?`
			)
			.all(count) as RepoRef[];
		if (rows.length < count) {
			throw new Error(`need ${count} repos, found ${rows.length}`);
		}
		return rows;
	} finally {
		db.close();
	}
}

async function runLevel(
	concurrency: number,
	repos: RepoRef[],
	trace: ReturnType<typeof installGithubConnTrace>
): Promise<LevelResult> {
	trace.reset();
	const cpu0 = process.cpuUsage();
	const wall0 = performance.now();

	const samples = await mapPool(repos, concurrency, (ref, { queueWaitMs }) =>
		fetchRepoSample(ref, queueWaitMs, trace)
	);

	const elapsedMs = Math.max(1, Math.round(performance.now() - wall0));
	const cpu = process.cpuUsage(cpu0);
	const mem = process.memoryUsage();
	const counters = trace.snapshot();
	const ok = samples.filter((s) => s.ok);
	const statuses: Record<string, number> = {};
	let retryLikeCount = 0;
	let retryAfterSeen = 0;
	let remainingMin: number | null = null;
	for (const s of samples) {
		statuses[String(s.status)] = (statuses[String(s.status)] ?? 0) + 1;
		if (s.status === 403 || s.status === 429 || s.retryAfter) retryLikeCount += 1;
		if (s.retryAfter) retryAfterSeen += 1;
		const rem = s.rateLimitRemaining != null ? Number(s.rateLimitRemaining) : NaN;
		if (Number.isFinite(rem)) {
			remainingMin = remainingMin == null ? rem : Math.min(remainingMin, rem);
		}
	}

	const reuseRate =
		counters.undiciRequests > 0 && counters.undiciClientConnected >= 0
			? Math.max(
					0,
					Math.min(
						1,
						1 - counters.undiciClientConnected / Math.max(1, counters.undiciRequests)
					)
				)
			: null;

	return {
		concurrency,
		sampleCount: samples.length,
		okCount: ok.length,
		errorCount: samples.length - ok.length,
		retryLikeCount,
		elapsedMs,
		throughputPerMin: Math.round((ok.length / (elapsedMs / 60_000)) * 10) / 10,
		queueWait: pair(samples.map((s) => s.queueWaitMs)),
		httpConnectTtfb: pair(samples.map((s) => s.httpConnectTtfbMs)),
		bodyRead: pair(samples.map((s) => s.bodyReadMs)),
		bodyBytes: pair(samples.map((s) => s.bodyBytes)),
		dns: pair(samples.map((s) => s.dnsMs)),
		tcpConnect: pair(samples.map((s) => s.tcpConnectMs)),
		tls: pair(samples.map((s) => s.tlsMs)),
		socketQueueOrServer: pair(samples.map((s) => s.socketQueueOrServerMs)),
		newTlsSocketRate:
			samples.length === 0
				? 0
				: Math.round(
						(samples.filter((s) => s.newTlsSocket).length / samples.length) * 1000
					) / 1000,
		dnsLookups: counters.dnsLookups,
		tcpConnects: counters.tcpConnects,
		tlsConnects: counters.tlsConnects,
		undiciRequests: counters.undiciRequests,
		undiciClientConnected: counters.undiciClientConnected,
		undiciConnectErrors: counters.undiciConnectErrors,
		socketReuseRate: reuseRate,
		activeSocketsEnd: trace.activeSocketCount(),
		eventLoop: trace.eventLoop(),
		cpuUserMs: Math.round(cpu.user / 1000),
		cpuSystemMs: Math.round(cpu.system / 1000),
		rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
		heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
		headerSummary: {
			rateLimitRemainingMin: remainingMin,
			retryAfterSeen,
			statuses
		}
	};
}

function printLevel(r: LevelResult): void {
	console.log(`\n${'='.repeat(72)}`);
	console.log(`concurrency=${r.concurrency}  n=${r.sampleCount}  ok=${r.okCount}  err=${r.errorCount}`);
	console.log(
		`throughput/min=${r.throughputPerMin}  elapsed_ms=${r.elapsedMs}  retry_like=${r.retryLikeCount}`
	);
	console.log(
		`queueWait     p50=${r.queueWait.p50}  p95=${r.queueWait.p95}  n=${r.queueWait.n}`
	);
	console.log(
		`httpConnectTtfb p50=${r.httpConnectTtfb.p50}  p95=${r.httpConnectTtfb.p95}  n=${r.httpConnectTtfb.n}`
	);
	console.log(
		`bodyRead      p50=${r.bodyRead.p50}  p95=${r.bodyRead.p95}  n=${r.bodyRead.n}`
	);
	console.log(
		`bodyBytes     p50=${r.bodyBytes.p50}  p95=${r.bodyBytes.p95}  n=${r.bodyBytes.n}`
	);
	console.log(
		`dns_ms        p50=${r.dns.p50}  p95=${r.dns.p95}  n=${r.dns.n}`
	);
	console.log(
		`tcp_connect   p50=${r.tcpConnect.p50}  p95=${r.tcpConnect.p95}  n=${r.tcpConnect.n}`
	);
	console.log(`tls_ms        p50=${r.tls.p50}  p95=${r.tls.p95}  n=${r.tls.n}`);
	console.log(
		`socket_queue_or_server p50=${r.socketQueueOrServer.p50}  p95=${r.socketQueueOrServer.p95}  n=${r.socketQueueOrServer.n}`
	);
	console.log(
		`conn: dns=${r.dnsLookups} tcp=${r.tcpConnects} tls=${r.tlsConnects} new_tls_rate=${r.newTlsSocketRate} undici_req=${r.undiciRequests} undici_connected=${r.undiciClientConnected} reuse_rate=${r.socketReuseRate ?? 'n/a'} active_sockets=${r.activeSocketsEnd}`
	);
	console.log(
		`event_loop_ms mean=${r.eventLoop.meanMs} p50=${r.eventLoop.p50Ms} p95=${r.eventLoop.p95Ms} max=${r.eventLoop.maxMs}`
	);
	console.log(
		`cpu_user_ms=${r.cpuUserMs} cpu_sys_ms=${r.cpuSystemMs} rss_mb=${r.rssMb} heap_mb=${r.heapUsedMb}`
	);
	console.log(
		`headers: ratelimit_remaining_min=${r.headerSummary.rateLimitRemainingMin} retry_after_seen=${r.headerSummary.retryAfterSeen} statuses=${JSON.stringify(r.headerSummary.statuses)}`
	);
}

async function main(): Promise<void> {
	const samplesPerLevel = Math.max(12, Number(argValue('--samples') ?? 36));
	const pauseMs = Math.max(0, Number(argValue('--pause-ms') ?? 5000));
	const outPath = argValue('--out') ?? 'data/github-concurrency-curve.json';
	const dbPath = resolveDbPath();

	if (!process.env.GITHUB_TOKEN?.trim()) {
		console.warn('WARNING: GITHUB_TOKEN unset — unauthenticated limits will distort the curve');
	}

	console.log(`db=${dbPath}`);
	console.log(`samples_per_level=${samplesPerLevel}`);
	console.log(`levels=${LEVELS.join(',')}`);
	console.log(`pause_ms=${pauseMs}`);
	console.log(`token=${process.env.GITHUB_TOKEN?.trim() ? 'present' : 'MISSING'}`);

	const totalNeeded = samplesPerLevel * LEVELS.length;
	const repos = loadRepos(dbPath, totalNeeded);
	const trace = installGithubConnTrace();

	const results: LevelResult[] = [];
	try {
		let offset = 0;
		for (const concurrency of LEVELS) {
			const batch = repos.slice(offset, offset + samplesPerLevel);
			offset += samplesPerLevel;
			console.log(`\n>>> starting concurrency=${concurrency} (${batch.length} fetches)`);
			const level = await runLevel(concurrency, batch, trace);
			results.push(level);
			printLevel(level);
			if (pauseMs > 0 && concurrency !== LEVELS[LEVELS.length - 1]) {
				await new Promise((r) => setTimeout(r, pauseMs));
			}
		}
	} finally {
		trace.stop();
	}

	const report = {
		recorded_at: new Date().toISOString(),
		host: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.HOSTNAME ?? 'local',
		samples_per_level: samplesPerLevel,
		levels: results,
		curve: results.map((r) => ({
			concurrency: r.concurrency,
			throughputPerMin: r.throughputPerMin,
			ttfbP50: r.httpConnectTtfb.p50,
			ttfbP95: r.httpConnectTtfb.p95,
			bodyReadP50: r.bodyRead.p50,
			bodyReadP95: r.bodyRead.p95,
			queueWaitP50: r.queueWait.p50,
			queueWaitP95: r.queueWait.p95,
			dnsP50: r.dns.p50,
			tcpP50: r.tcpConnect.p50,
			tlsP50: r.tls.p50,
			socketQueueOrServerP50: r.socketQueueOrServer.p50,
			socketQueueOrServerP95: r.socketQueueOrServer.p95,
			errors: r.errorCount,
			retryLike: r.retryLikeCount,
			sampleCount: r.sampleCount,
			socketReuseRate: r.socketReuseRate,
			newTlsSocketRate: r.newTlsSocketRate,
			dnsLookups: r.dnsLookups,
			tlsConnects: r.tlsConnects,
			eventLoopP95Ms: r.eventLoop.p95Ms
		}))
	};

	writeFileSync(outPath, JSON.stringify(report, null, 2));
	console.log(`\nWrote ${outPath}`);
	console.log('\nCURVE_SUMMARY');
	console.log(
		'conc\tthru/min\tttfb_p50\tttfb_p95\tbody_p50\tbody_p95\tqueue_p50\terr\tretry\tn\treuse'
	);
	for (const row of report.curve) {
		console.log(
			[
				row.concurrency,
				row.throughputPerMin,
				row.ttfbP50,
				row.ttfbP95,
				row.bodyReadP50,
				row.bodyReadP95,
				row.queueWaitP50,
				row.errors,
				row.retryLike,
				row.sampleCount,
				row.socketReuseRate ?? 'n/a'
			].join('\t')
		);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
