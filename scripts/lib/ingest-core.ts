import '../load-env.js';
import { recordArchiveHourMetrics } from '../../src/lib/server/db/archive-hour-metrics.js';
import { commitGhArchiveCreates } from '../../src/lib/server/ingest-commit.js';
import {
	ingestReposFromSearch,
	shouldRunSearchFallback
} from '../../src/lib/server/repo-discovery.js';
import {
	archiveUrlForKey,
	defaultHourKey,
	GhArchiveFetchError,
	GhArchiveParseError,
	GhArchiveTimeoutError,
	GhArchiveUnavailableError,
	parseHourKey,
	streamRepositoryCreates,
	type RepoCreateEvent
} from '../../src/lib/server/gharchive.js';
import { GitHubRateLimitError } from '../../src/lib/server/github.js';

export type IngestOutcome = 'downloaded' | 'unavailable' | 'failed';
export type IngestSource = 'gharchive' | 'github_search' | 'gharchive+github_search';

export interface ArchiveHourSpans {
	archive_fetch_ms: number;
	archive_parse_ms: number;
	archive_commit_ms: number;
	archive_hour_total_ms: number;
	archive_rows_created: number;
	archive_rows_existing: number;
	archive_batches: number;
	archive_deferred_rows: number;
	archive_frontier_lag_hours: number;
}

export interface IngestResult {
	hourKey: string;
	url: string;
	outcome: IngestOutcome;
	httpStatus?: number;
	parsedEvents: number;
	repoCreates: number;
	inserted: number;
	skipped: number;
	source: IngestSource;
	searchFound?: number;
	searchQuery?: string;
	error?: string;
	retries: number;
	/** Present on successful GH Archive downloads. */
	archive?: ArchiveHourSpans;
}

const RETRY_MAX = Number(process.env.INGEST_RETRY_MAX ?? 3);
const RETRY_BASE_MS = Number(process.env.INGEST_RETRY_BASE_MS ?? 5000);
const RECENT_HOUR_WINDOW = Number(process.env.INGEST_RECENT_HOUR_WINDOW ?? 3);

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

function isRecentHour(hourKey: string): boolean {
	const latest = parseHourKey(defaultHourKey()).getTime();
	const hour = parseHourKey(hourKey).getTime();
	return latest - hour <= RECENT_HOUR_WINDOW * 60 * 60 * 1000;
}

function resolveSource(ghInserted: number, searchInserted: number): IngestSource {
	if (searchInserted > 0 && ghInserted > 0) return 'gharchive+github_search';
	if (searchInserted > 0) return 'github_search';
	return 'gharchive';
}

async function ingestHourOnce(hourKey: string, url: string): Promise<IngestResult> {
	const firstSeenAt = new Date().toISOString();
	const creates: RepoCreateEvent[] = [];

	// Collect during the stream; commit afterwards. Writing per-event was the
	// dominant cost of an hour and left partial inserts whenever the cycle
	// aborted mid-stream.
	const stats = await streamRepositoryCreates(url, (event) => {
		creates.push(event);
	});
	console.log(
		`  [ingest] ${hourKey}: streamed ${stats.parsedEvents} events → ` +
			`${creates.length} creates` +
			` (fetch ${Math.round(stats.archiveFetchMs)}ms / parse ${Math.round(stats.archiveParseMs)}ms)`
	);
	const committed = await commitGhArchiveCreates(creates, firstSeenAt);
	console.log(
		`  [ingest] ${hourKey}: committed +${committed.inserted}/` +
			`${committed.skipped} skip` +
			` (${committed.deferred} deferred, ${committed.batches} batches, ${committed.commitMs}ms)`
	);
	const ghInserted = committed.inserted;
	const ghSkipped = committed.skipped;
	// Total is GH Archive only — Search fallback must not inflate archive_hour_total_ms.
	const archiveTotalMs =
		stats.archiveFetchMs + stats.archiveParseMs + committed.commitMs;
	const archiveSpans: ArchiveHourSpans = {
		archive_fetch_ms: stats.archiveFetchMs,
		archive_parse_ms: stats.archiveParseMs,
		archive_commit_ms: committed.commitMs,
		archive_hour_total_ms: archiveTotalMs,
		archive_rows_created: committed.inserted,
		archive_rows_existing: committed.skipped,
		archive_batches: committed.batches,
		archive_deferred_rows: committed.deferred,
		archive_frontier_lag_hours: Math.max(
			0,
			(parseHourKey(defaultHourKey()).getTime() - parseHourKey(hourKey).getTime()) /
				3_600_000
		)
	};
	recordArchiveHourMetrics({
		hourKey,
		archiveFetchMs: archiveSpans.archive_fetch_ms,
		archiveParseMs: archiveSpans.archive_parse_ms,
		archiveCommitMs: archiveSpans.archive_commit_ms,
		archiveHourTotalMs: archiveSpans.archive_hour_total_ms,
		archiveRowsCreated: archiveSpans.archive_rows_created,
		archiveRowsExisting: archiveSpans.archive_rows_existing,
		archiveBatches: archiveSpans.archive_batches,
		archiveDeferredRows: archiveSpans.archive_deferred_rows,
		parsedEvents: stats.parsedEvents,
		repoCreates: stats.repoCreates
	});

	let searchFound = 0;
	let searchInserted = 0;
	let searchSkipped = 0;
	let searchQuery: string | undefined;
	let source: IngestSource = 'gharchive';

	const refTypeSummary = Object.entries(stats.createRefTypes)
		.map(([k, v]) => `${k}=${v}`)
		.join(', ');

	if (shouldRunSearchFallback(stats.parsedEvents, stats.repoCreates, hourKey)) {
		console.log(
			`  ${hourKey}: GH Archive had ${stats.parsedEvents} events, CreateEvent=${stats.createEvents}` +
				`${refTypeSummary ? ` (${refTypeSummary})` : ''}, matched repo creates=0 — Search fallback started`
		);
		if (!process.env.GITHUB_TOKEN) {
			console.warn('  GITHUB_TOKEN recommended for Search API (30 req/min unauthenticated).');
		}
		const search = await ingestReposFromSearch(hourKey);
		searchFound = search.found;
		searchInserted = search.inserted;
		searchSkipped = search.skipped;
		searchQuery = search.query;
		source = resolveSource(ghInserted, searchInserted);
		console.log(
			`  ${hourKey}: [github_search] total_count=${search.totalCount} found=${search.found} inserted=${search.inserted} skipped=${search.skipped} shards=${search.shards} pages=${search.pages}${search.incomplete ? ' (incomplete)' : ''}`
		);
	} else if (stats.repoCreates === 0 && stats.parsedEvents > 0) {
		console.log(
			`  ${hourKey}: GH Archive had ${stats.parsedEvents} events, CreateEvent=${stats.createEvents}` +
				`${refTypeSummary ? ` (${refTypeSummary})` : ''}, matched repo creates=0 (search fallback skipped)`
		);
	} else if (stats.repoCreates > 0) {
		console.log(
			`  ${hourKey}: [gharchive] ${stats.repoCreates} repo CreateEvents` +
				` (CreateEvent=${stats.createEvents}${refTypeSummary ? `, ${refTypeSummary}` : ''})`
		);
	}

	return {
		hourKey,
		url,
		outcome: 'downloaded',
		parsedEvents: stats.parsedEvents,
		repoCreates: stats.repoCreates,
		inserted: ghInserted + searchInserted,
		skipped: ghSkipped + searchSkipped,
		source,
		searchFound,
		searchQuery,
		retries: 0,
		archive: archiveSpans
	};
}

export async function ingestHour(hourKey: string): Promise<IngestResult> {
	const url = archiveUrlForKey(hourKey);
	const maxRetries = isRecentHour(hourKey) ? RETRY_MAX : 0;
	let retries = 0;

	while (true) {
		try {
			const result = await ingestHourOnce(hourKey, url);
			result.retries = retries;
			return result;
		} catch (err) {
			if (err instanceof GitHubRateLimitError) {
				return {
					hourKey,
					url,
					outcome: 'failed',
					parsedEvents: 0,
					repoCreates: 0,
					inserted: 0,
					skipped: 0,
					source: 'gharchive',
					error: err.message,
					retries
				};
			}
			if (err instanceof GhArchiveUnavailableError) {
				if (retries < maxRetries) {
					retries++;
					const wait = RETRY_BASE_MS * 2 ** (retries - 1);
					console.warn(
						`  ${hourKey}: GH Archive unavailable (HTTP ${err.httpStatus}), retry ${retries}/${maxRetries} in ${Math.round(wait / 1000)}s…`
					);
					await sleep(wait);
					continue;
				}
				return {
					hourKey,
					url,
					outcome: 'unavailable',
					httpStatus: err.httpStatus,
					parsedEvents: 0,
					repoCreates: 0,
					inserted: 0,
					skipped: 0,
					source: 'gharchive',
					error: err.message,
					retries
				};
			}

			if (err instanceof GhArchiveFetchError) {
				return {
					hourKey,
					url,
					outcome: 'failed',
					httpStatus: err.httpStatus,
					parsedEvents: 0,
					repoCreates: 0,
					inserted: 0,
					skipped: 0,
					source: 'gharchive',
					error: err.message,
					retries
				};
			}

			if (err instanceof GhArchiveTimeoutError) {
				return {
					hourKey,
					url,
					outcome: 'failed',
					parsedEvents: 0,
					repoCreates: 0,
					inserted: 0,
					skipped: 0,
					source: 'gharchive',
					error: err.message,
					retries
				};
			}

			if (err instanceof GhArchiveParseError) {
				return {
					hourKey,
					url,
					outcome: 'failed',
					parsedEvents: 0,
					repoCreates: 0,
					inserted: 0,
					skipped: 0,
					source: 'gharchive',
					error: err.message,
					retries
				};
			}

			return {
				hourKey,
				url,
				outcome: 'failed',
				parsedEvents: 0,
				repoCreates: 0,
				inserted: 0,
				skipped: 0,
				source: 'gharchive',
				error: err instanceof Error ? err.message : String(err),
				retries
			};
		}
	}
}

export function formatIngestLine(result: IngestResult): string {
	const base = `  ${result.hourKey}:`;
	if (result.outcome === 'downloaded') {
		const sourceTag = `[${result.source}]`;
		const searchPart =
			result.searchFound != null && result.searchFound > 0
				? `, search found ${result.searchFound}`
				: '';
		return `${base} downloaded ${sourceTag} — ${result.parsedEvents} parsed events, ${result.repoCreates} repo CreateEvents, +${result.inserted} new, ${result.skipped} skipped${searchPart}`;
	}
	if (result.outcome === 'unavailable') {
		return `${base} GH Archive unavailable (HTTP ${result.httpStatus ?? '?'}) — not marked complete`;
	}
	return `${base} failed — ${result.error ?? 'unknown error'}`;
}

export function isIngestSuccess(result: IngestResult): boolean {
	return result.outcome === 'downloaded';
}

export function ingestSourceForRecord(result: IngestResult): string {
	return result.source;
}
