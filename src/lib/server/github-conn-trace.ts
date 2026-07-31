/**
 * Process-local hooks for diagnosing GitHub HTTP concurrency behavior.
 * Measurement-only — install in probe scripts, not the enrich daemon path.
 *
 * Aggregates DNS / TCP / TLS activity and undici connect vs request events.
 * Optional AsyncLocalStorage attaches per-request dns/tcp/tls timings when a
 * store is active around a fetch.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import diagnostics_channel from 'node:diagnostics_channel';
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

export interface ConnTraceCounters {
	dnsLookups: number;
	tcpConnects: number;
	tlsConnects: number;
	undiciRequests: number;
	undiciClientConnected: number;
	undiciConnectErrors: number;
}

/** Per-request connection spans (populated when runWithConnSpans is used). */
export interface ConnRequestSpans {
	dnsMs: number;
	tcpConnectMs: number;
	tlsMs: number;
	/** Set when a new TLS socket is established (false implies likely reuse). */
	newTlsSocket: boolean;
}

export interface EventLoopSnapshot {
	meanMs: number;
	p50Ms: number;
	p95Ms: number;
	maxMs: number;
}

export interface ConnTraceHandle {
	reset(): void;
	snapshot(): ConnTraceCounters;
	eventLoop(): EventLoopSnapshot;
	activeSocketCount(): number;
	runWithConnSpans<T>(fn: () => Promise<T>): Promise<{ result: T; spans: ConnRequestSpans }>;
	stop(): void;
}

const spanAls = new AsyncLocalStorage<ConnRequestSpans>();

let installed: ConnTraceHandle | null = null;

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const rank = Math.ceil((p / 100) * sorted.length);
	const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
	return sorted[idx];
}

function emptyRequestSpans(): ConnRequestSpans {
	return { dnsMs: 0, tcpConnectMs: 0, tlsMs: 0, newTlsSocket: false };
}

/**
 * Install monkey-patches + undici diagnostics. Safe to call once per process.
 * Must call `stop()` when the probe finishes.
 */
export function installGithubConnTrace(): ConnTraceHandle {
	if (installed) return installed;

	const counters: ConnTraceCounters = {
		dnsLookups: 0,
		tcpConnects: 0,
		tlsConnects: 0,
		undiciRequests: 0,
		undiciClientConnected: 0,
		undiciConnectErrors: 0
	};

	const origLookup = dns.lookup;
	dns.lookup = ((hostname: Parameters<typeof dns.lookup>[0], options: unknown, callback?: unknown) => {
		counters.dnsLookups += 1;
		const spans = spanAls.getStore();
		const started = performance.now();
		if (typeof options === 'function') {
			return origLookup(hostname, ((err: NodeJS.ErrnoException | null, address: string, family: number) => {
				if (spans) spans.dnsMs += Math.max(0, performance.now() - started);
				(options as dns.LookupCallback)(err, address, family);
			}) as dns.LookupCallback);
		}
		return origLookup(
			hostname,
			options as dns.LookupOptions,
			((err: NodeJS.ErrnoException | null, address: string, family: number) => {
				if (spans) spans.dnsMs += Math.max(0, performance.now() - started);
				(callback as dns.LookupCallback)(err, address, family);
			}) as dns.LookupCallback
		);
	}) as typeof dns.lookup;

	const origNetConnect = net.connect;
	(net as { connect: typeof net.connect }).connect = ((...args: unknown[]) => {
		counters.tcpConnects += 1;
		const spans = spanAls.getStore();
		const started = performance.now();
		const socket = (origNetConnect as (...a: unknown[]) => net.Socket)(...args);
		if (spans) {
			socket.once('connect', () => {
				spans.tcpConnectMs += Math.max(0, performance.now() - started);
			});
		}
		return socket;
	}) as typeof net.connect;

	const origTlsConnect = tls.connect;
	(tls as { connect: typeof tls.connect }).connect = ((...args: unknown[]) => {
		counters.tlsConnects += 1;
		const spans = spanAls.getStore();
		const started = performance.now();
		const socket = (origTlsConnect as (...a: unknown[]) => tls.TLSSocket)(...args);
		if (spans) {
			spans.newTlsSocket = true;
			socket.once('secureConnect', () => {
				spans.tlsMs += Math.max(0, performance.now() - started);
			});
		}
		return socket;
	}) as typeof tls.connect;

	const onRequestCreate = () => {
		counters.undiciRequests += 1;
	};
	const onClientConnected = () => {
		counters.undiciClientConnected += 1;
	};
	const onConnectError = () => {
		counters.undiciConnectErrors += 1;
	};

	const chRequest = diagnostics_channel.channel('undici:request:create');
	const chConnected = diagnostics_channel.channel('undici:client:connected');
	const chConnectErr = diagnostics_channel.channel('undici:client:connectError');
	chRequest.subscribe(onRequestCreate);
	chConnected.subscribe(onClientConnected);
	chConnectErr.subscribe(onConnectError);

	const loop: IntervalHistogram = monitorEventLoopDelay({ resolution: 10 });
	loop.enable();

	const handle: ConnTraceHandle = {
		reset() {
			counters.dnsLookups = 0;
			counters.tcpConnects = 0;
			counters.tlsConnects = 0;
			counters.undiciRequests = 0;
			counters.undiciClientConnected = 0;
			counters.undiciConnectErrors = 0;
			loop.reset();
		},
		snapshot() {
			return { ...counters };
		},
		eventLoop() {
			const toMs = (ns: number) => Math.round((ns / 1e6) * 10) / 10;
			return {
				meanMs: toMs(loop.mean),
				p50Ms: toMs(loop.percentile(50)),
				p95Ms: toMs(loop.percentile(95)),
				maxMs: toMs(loop.max)
			};
		},
		activeSocketCount() {
			const handles = (
				process as NodeJS.Process & { _getActiveHandles?: () => unknown[] }
			)._getActiveHandles?.();
			if (!handles) return -1;
			return handles.filter(
				(h) => h && typeof h === 'object' && 'remoteAddress' in (h as object)
			).length;
		},
		async runWithConnSpans<T>(fn: () => Promise<T>) {
			const spans = emptyRequestSpans();
			const result = await spanAls.run(spans, fn);
			return { result, spans };
		},
		stop() {
			dns.lookup = origLookup;
			(net as { connect: typeof net.connect }).connect = origNetConnect;
			(tls as { connect: typeof tls.connect }).connect = origTlsConnect;
			chRequest.unsubscribe(onRequestCreate);
			chConnected.unsubscribe(onClientConnected);
			chConnectErr.unsubscribe(onConnectError);
			loop.disable();
			installed = null;
		}
	};

	installed = handle;
	return handle;
}

/** Nearest-rank percentile helper shared with the measure script. */
export function nearestRankPercentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return percentile(sorted, p);
}
