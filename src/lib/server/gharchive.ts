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

export function isRepositoryCreateEvent(event: GhArchiveEvent): boolean {
	if (event.type !== 'CreateEvent' || !event.repo?.name) return false;
	const payload = parsePayload(event.payload);
	if (!payload) return false;
	if (payload.ref_type === 'repository' || payload.ref_type === 'repo') return true;
	// Repo creates use ref: null; branch/tag creates set ref to the branch/tag name.
	if (
		(payload.ref === null || payload.ref === undefined) &&
		payload.ref_type !== 'branch' &&
		payload.ref_type !== 'tag' &&
		event.repo.name.includes('/')
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

async function readHourStream(url: string, res: Response): Promise<Readable> {
	const body = res.body;
	if (!body) {
		throw new GhArchiveFetchError(url, res.status, `GH Archive empty response body: ${url}`);
	}

	const nodeStream = Readable.fromWeb(body as import('node:stream/web').ReadableStream);
	const gunzip = createGunzip();
	return nodeStream.pipe(gunzip);
}

/**
 * Stream-parse a GH Archive hour file.
 * Throws GhArchiveUnavailableError, GhArchiveFetchError, or GhArchiveParseError on failure.
 */
export async function streamRepositoryCreates(
	url: string,
	onCreate?: (event: RepoCreateEvent) => void | Promise<void>
): Promise<HourStreamStats> {
	const res = await fetch(url);

	if (res.status === 404 || res.status === 403) {
		throw new GhArchiveUnavailableError(url, res.status);
	}
	if (res.status >= 500) {
		throw new GhArchiveFetchError(url, res.status);
	}
	if (!res.ok) {
		throw new GhArchiveFetchError(url, res.status);
	}

	const combined = await readHourStream(url, res);
	const stats: HourStreamStats = { parsedEvents: 0, repoCreates: 0 };

	let buffer = '';
	try {
		for await (const chunk of combined) {
			buffer += chunk.toString('utf8');
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line) as GhArchiveEvent;
					stats.parsedEvents++;
					const repo = toRepoCreateEvent(event);
					if (repo) {
						stats.repoCreates++;
						if (onCreate) await onCreate(repo);
					}
				} catch {
					// skip malformed lines
				}
			}
		}

		if (buffer.trim()) {
			try {
				const event = JSON.parse(buffer) as GhArchiveEvent;
				stats.parsedEvents++;
				const repo = toRepoCreateEvent(event);
				if (repo) {
					stats.repoCreates++;
					if (onCreate) await onCreate(repo);
				}
			} catch {
				// ignore trailing partial line
			}
		}
	} catch (err) {
		if (
			err instanceof GhArchiveUnavailableError ||
			err instanceof GhArchiveFetchError ||
			err instanceof GhArchiveParseError
		) {
			throw err;
		}
		throw new GhArchiveParseError(url, err);
	}

	return stats;
}

/** Stream all parsed events from a GH Archive hour file (for inspection/debug). */
export async function* streamHourEvents(url: string): AsyncGenerator<GhArchiveEvent> {
	const res = await fetch(url);

	if (res.status === 404 || res.status === 403) {
		throw new GhArchiveUnavailableError(url, res.status);
	}
	if (res.status >= 500) {
		throw new GhArchiveFetchError(url, res.status);
	}
	if (!res.ok) {
		throw new GhArchiveFetchError(url, res.status);
	}

	const combined = await readHourStream(url, res);
	let buffer = '';

	try {
		for await (const chunk of combined) {
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
		if (
			err instanceof GhArchiveUnavailableError ||
			err instanceof GhArchiveFetchError ||
			err instanceof GhArchiveParseError
		) {
			throw err;
		}
		throw new GhArchiveParseError(url, err);
	}
}
