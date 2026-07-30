import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

export const GH_ARCHIVE_BASE = 'https://data.gharchive.org';

export interface GhArchiveEvent {
	id: string | number;
	type: string;
	repo?: { name: string };
	created_at: string;
	payload?: GhArchivePayload | string;
}

export interface GhArchivePayload {
	ref_type?: string;
	ref?: string | null;
	/** Default branch name on CreateEvent payloads (used after repo CreateEvents vanished). */
	master_branch?: string | null;
	[key: string]: unknown;
}

export interface RepoCreateEvent {
	owner: string;
	name: string;
	full_name: string;
	github_url: string;
	event_id: string;
	created_at: string;
}

export interface HourStreamStats {
	parsedEvents: number;
	repoCreates: number;
	/** Raw CreateEvent count (all ref_types), for diagnostics. */
	createEvents: number;
	/** CreateEvent payload.ref_type histogram. */
	createRefTypes: Record<string, number>;
}

export class GhArchiveUnavailableError extends Error {
	constructor(
		public readonly url: string,
		public readonly httpStatus: number
	) {
		super(`GH Archive unavailable (HTTP ${httpStatus}): ${url}`);
		this.name = 'GhArchiveUnavailableError';
	}
}

export class GhArchiveFetchError extends Error {
	constructor(
		public readonly url: string,
		public readonly httpStatus: number,
		message?: string
	) {
		super(message ?? `GH Archive fetch failed (HTTP ${httpStatus}): ${url}`);
		this.name = 'GhArchiveFetchError';
	}
}

export class GhArchiveParseError extends Error {
	constructor(
		public readonly url: string,
		cause: unknown
	) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		super(`GH Archive invalid gzip or corrupt data: ${url} (${detail})`);
		this.name = 'GhArchiveParseError';
		this.cause = cause;
	}
}

/** Timed out waiting for GH Archive fetch and/or body stream (AbortSignal). */
export class GhArchiveTimeoutError extends Error {
	constructor(
		public readonly url: string,
		public readonly timeoutMs: number
	) {
		super(`GH Archive fetch timed out after ${timeoutMs}ms: ${url}`);
		this.name = 'GhArchiveTimeoutError';
	}
}

function envMs(name: string, fallback: number): number {
	const n = Number(process.env[name] ?? fallback);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Connection + response-headers ceiling. Env: GH_ARCHIVE_FETCH_TIMEOUT_MS (default 30s). */
export function ghArchiveFetchTimeoutMs(): number {
	return envMs('GH_ARCHIVE_FETCH_TIMEOUT_MS', 30_000);
}

/**
 * Longest permitted wait for the *next* body chunk. Deliberately not a budget for
 * the whole hour: parsing 172k events and inserting the repository creates they
 * imply is legitimate work that took ~27s of a 30s total budget in production and
 * failed every hour as a result. Stall time is the only thing a transfer guard
 * can meaningfully police.
 */
export function ghArchiveStallTimeoutMs(): number {
	return envMs('GH_ARCHIVE_STALL_TIMEOUT_MS', 30_000);
}

/**
 * Absolute per-hour ceiling, so a pathological hour still fails and enters
 * ingest_hour_backoff rather than occupying the daemon indefinitely.
 */
export function ghArchiveHourMaxMs(): number {
	return envMs('GH_ARCHIVE_HOUR_MAX_MS', 900_000);
}

function isAbortError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const name = (err as { name?: string }).name;
	return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Run `fn` with an AbortSignal that fires after a fixed deadline.
 *
 * Only appropriate where the whole operation is transfer. Do not wrap a read
 * loop that also parses or writes: the deadline then measures our own work and
 * reports it as a fetch timeout.
 */
export async function withGhArchiveTimeout<T>(
	url: string,
	fn: (signal: AbortSignal) => Promise<T>,
	timeoutMs: number = ghArchiveFetchTimeoutMs()
): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fn(controller.signal);
	} catch (err) {
		if (controller.signal.aborted || isAbortError(err)) {
			throw new GhArchiveTimeoutError(url, timeoutMs);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

async function fetchGhArchiveResponse(url: string, signal: AbortSignal): Promise<Response> {
	try {
		return await fetch(url, { signal });
	} catch (err) {
		if (signal.aborted || isAbortError(err)) {
			throw new GhArchiveTimeoutError(url, ghArchiveFetchTimeoutMs());
		}
		throw err;
	}
}

function parsePayload(payload: GhArchiveEvent['payload']): GhArchivePayload | null {
	if (payload == null) return null;
	if (typeof payload === 'string') {
		try {
			return JSON.parse(payload) as GhArchivePayload;
		} catch {
			return null;
		}
	}
	return payload;
}

/**
 * Detect repository-birth CreateEvents in GH Archive.
 *
 * Historically GitHub emitted `ref_type: "repository"`. After ~2025-10 those
 * payloads disappeared from GH Archive (only `ref_type: "branch"|"tag"` remain).
 * New public repos still typically emit a CreateEvent for their default branch
 * where `ref === master_branch` — treat that as the post-cutoff birth signal.
 *
 * Existing repos that recreate their default branch are INSERT OR IGNORE no-ops.
 */
export function isRepositoryCreateEvent(event: GhArchiveEvent): boolean {
	if (event.type !== 'CreateEvent' || !event.repo?.name?.includes('/')) return false;
	const payload = parsePayload(event.payload);
	if (!payload) return false;
	if (payload.ref_type === 'repository' || payload.ref_type === 'repo') return true;
	// Legacy repo creates use ref: null; branch/tag creates set ref to the name.
	if (
		(payload.ref === null || payload.ref === undefined) &&
		payload.ref_type !== 'branch' &&
		payload.ref_type !== 'tag'
	) {
		return true;
	}
	// Post ~2025-10 GH Archive: default-branch CreateEvent ≈ repository birth.
	if (
		payload.ref_type === 'branch' &&
		typeof payload.ref === 'string' &&
		typeof payload.master_branch === 'string' &&
		payload.ref.length > 0 &&
		payload.ref === payload.master_branch
	) {
		return true;
	}
	return false;
}

export function hourKey(date: Date): string {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, '0');
	const d = String(date.getUTCDate()).padStart(2, '0');
	const h = String(date.getUTCHours()).padStart(2, '0');
	return `${y}-${m}-${d}-${h}`;
}

export function archiveUrlForKey(key: string): string {
	// GH Archive filenames use non-padded hours (…-5.json.gz, not …-05.json.gz).
	const match = key.match(/^(\d{4}-\d{2}-\d{2})-(\d{1,2})$/);
	if (match) {
		return `${GH_ARCHIVE_BASE}/${match[1]}-${Number(match[2])}.json.gz`;
	}
	return `${GH_ARCHIVE_BASE}/${key}.json.gz`;
}

/** Previous complete UTC hour (GH Archive files appear ~1h after the hour ends). */
export function defaultHourKey(nowMs: number = Date.now()): string {
	const d = new Date(nowMs);
	d.setUTCHours(d.getUTCHours() - 1, 0, 0, 0);
	return hourKey(d);
}

/** Completed UTC hours today through the latest publishable hour. */
export function hourKeysForToday(): string[] {
	const now = new Date();
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const upTo = parseHourKey(defaultHourKey()).getTime();
	const keys: string[] = [];

	for (let t = start.getTime(); t <= upTo; t += 60 * 60 * 1000) {
		keys.push(hourKey(new Date(t)));
	}
	return keys;
}

export function parseHourKey(key: string): Date {
	const [y, m, d, h] = key.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d, h, 0, 0, 0));
}

export function nextHourKey(key: string): string {
	const d = parseHourKey(key);
	d.setUTCHours(d.getUTCHours() + 1);
	return hourKey(d);
}

/** Inclusive range of UTC hour keys from `from` through `to`. */
export function listHourKeysBetween(from: string, to: string): string[] {
	const keys: string[] = [];
	let current = from;
	const end = parseHourKey(to).getTime();

	while (parseHourKey(current).getTime() <= end) {
		keys.push(current);
		current = nextHourKey(current);
	}
	return keys;
}

function toRepoCreateEvent(event: GhArchiveEvent): RepoCreateEvent | null {
	if (!isRepositoryCreateEvent(event)) return null;
	const [owner, name] = event.repo!.name.split('/');
	if (!owner || !name) return null;
	return {
		owner,
		name,
		full_name: event.repo!.name,
		github_url: `https://github.com/${event.repo!.name}`,
		event_id: String(event.id),
		created_at: event.created_at
	};
}

/**
 * Web-fetch body → gunzip. Abort/cancel must not emit an unhandled Readable
 * 'error' (that crashes Node and fails the Railway deploy). Always attach
 * listeners before pipe, and destroy both ends when the hour signal aborts.
 */
async function readHourStream(
	url: string,
	res: Response,
	signal: AbortSignal
): Promise<Readable> {
	const body = res.body;
	if (!body) {
		throw new GhArchiveFetchError(url, res.status, `GH Archive empty response body: ${url}`);
	}

	const nodeStream = Readable.fromWeb(body as import('node:stream/web').ReadableStream);
	const gunzip = createGunzip();

	const abortErr = () => {
		const err = new Error('The operation was aborted');
		err.name = 'AbortError';
		return err;
	};

	// Keep a listener on both streams for the whole lifetime so AbortError from
	// fetch cancellation cannot become an unhandled 'error' event.
	nodeStream.on('error', (err) => {
		if (!gunzip.destroyed) gunzip.destroy(err);
	});
	gunzip.on('error', () => {
		/* for-await / destroy still surface the error to the consumer */
	});

	const destroyBoth = () => {
		const err = abortErr();
		if (!nodeStream.destroyed) nodeStream.destroy(err);
		if (!gunzip.destroyed) gunzip.destroy(err);
	};
	if (signal.aborted) destroyBoth();
	else signal.addEventListener('abort', destroyBoth, { once: true });

	nodeStream.pipe(gunzip);
	return gunzip;
}

/**
 * Yield chunks while timing only the wait for each next chunk.
 *
 * The timer is cleared before yielding, so whatever the consumer does with a
 * chunk — parse it, insert rows — runs with no deadline attached. `abort` fires
 * on stall so readHourStream's listener can tear both streams down through the
 * same path a fetch cancellation uses.
 */
async function* readChunksWithStallTimeout(
	source: AsyncIterable<Buffer>,
	url: string,
	abort: () => void,
	stallMs: number = ghArchiveStallTimeoutMs(),
	maxMs: number = ghArchiveHourMaxMs()
): AsyncGenerator<Buffer> {
	const iterator = source[Symbol.asyncIterator]();
	const startedAt = Date.now();

	while (true) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let next: IteratorResult<Buffer>;
		try {
			next = await Promise.race([
				iterator.next(),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => {
						abort();
						reject(new GhArchiveTimeoutError(url, stallMs));
					}, stallMs);
				})
			]);
		} finally {
			clearTimeout(timer);
		}

		if (next.done) return;
		if (Date.now() - startedAt > maxMs) {
			abort();
			throw new GhArchiveTimeoutError(url, maxMs);
		}
		yield next.value;
	}
}

function assertGhArchiveHttpOk(url: string, res: Response): void {
	if (res.status === 404 || res.status === 403) {
		throw new GhArchiveUnavailableError(url, res.status);
	}
	if (res.status >= 500) {
		throw new GhArchiveFetchError(url, res.status);
	}
	if (!res.ok) {
		throw new GhArchiveFetchError(url, res.status);
	}
}

function rethrowGhArchiveStreamError(url: string, err: unknown): never {
	if (
		err instanceof GhArchiveUnavailableError ||
		err instanceof GhArchiveFetchError ||
		err instanceof GhArchiveParseError ||
		err instanceof GhArchiveTimeoutError
	) {
		throw err;
	}
	if (isAbortError(err)) {
		throw new GhArchiveTimeoutError(url, ghArchiveFetchTimeoutMs());
	}
	throw new GhArchiveParseError(url, err);
}

/**
 * Stream-parse a GH Archive hour file.
 * Throws GhArchiveUnavailableError, GhArchiveFetchError, GhArchiveTimeoutError,
 * or GhArchiveParseError on failure.
 */
export async function streamRepositoryCreates(
	url: string,
	onCreate?: (event: RepoCreateEvent) => void | Promise<void>
): Promise<HourStreamStats> {
	const controller = new AbortController();
	const signal = controller.signal;
	// The deadline covers connection and headers only; it is cleared before the
	// body is read so parse and insert work cannot be reported as a fetch timeout.
	const connectTimer = setTimeout(() => controller.abort(), ghArchiveFetchTimeoutMs());
	let res: Response;
	try {
		res = await fetchGhArchiveResponse(url, signal);
		assertGhArchiveHttpOk(url, res);
	} finally {
		clearTimeout(connectTimer);
	}

	return (async () => {
		const combined = await readHourStream(url, res, signal);
		const stats: HourStreamStats = {
			parsedEvents: 0,
			repoCreates: 0,
			createEvents: 0,
			createRefTypes: {}
		};

		const observe = async (event: GhArchiveEvent) => {
			stats.parsedEvents++;
			if (event.type === 'CreateEvent') {
				stats.createEvents++;
				const payload = parsePayload(event.payload);
				const refType = payload?.ref_type ?? '(missing)';
				stats.createRefTypes[refType] = (stats.createRefTypes[refType] ?? 0) + 1;
			}
			const repo = toRepoCreateEvent(event);
			if (repo) {
				stats.repoCreates++;
				if (onCreate) await onCreate(repo);
			}
		};

		let buffer = '';
		try {
			for await (const chunk of readChunksWithStallTimeout(combined, url, () =>
				controller.abort()
			)) {
				buffer += chunk.toString('utf8');
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						await observe(JSON.parse(line) as GhArchiveEvent);
					} catch {
						// skip malformed lines
					}
				}
			}

			if (buffer.trim()) {
				try {
					await observe(JSON.parse(buffer) as GhArchiveEvent);
				} catch {
					// ignore trailing partial line
				}
			}
		} catch (err) {
			rethrowGhArchiveStreamError(url, err);
		}

		return stats;
	})();
}

/** Stream all parsed events from a GH Archive hour file (for inspection/debug). */
export async function* streamHourEvents(url: string): AsyncGenerator<GhArchiveEvent> {
	const controller = new AbortController();
	const connectTimer = setTimeout(() => controller.abort(), ghArchiveFetchTimeoutMs());
	let res: Response;
	try {
		res = await fetchGhArchiveResponse(url, controller.signal);
		assertGhArchiveHttpOk(url, res);
	} finally {
		clearTimeout(connectTimer);
	}

	const combined = await readHourStream(url, res, controller.signal);
	let buffer = '';

	try {
		// Consumers of this generator do arbitrary work per event, so the same
		// stall-only accounting applies here as in streamRepositoryCreates.
		for await (const chunk of readChunksWithStallTimeout(combined, url, () =>
			controller.abort()
		)) {
			buffer += chunk.toString('utf8');
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					yield JSON.parse(line) as GhArchiveEvent;
				} catch {
					// skip malformed lines
				}
			}
		}

		if (buffer.trim()) {
			try {
				yield JSON.parse(buffer) as GhArchiveEvent;
			} catch {
				// ignore trailing partial line
			}
		}
	} catch (err) {
		rethrowGhArchiveStreamError(url, err);
	}
}
