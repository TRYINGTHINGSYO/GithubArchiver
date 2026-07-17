import { appendRepoEvent } from '../../src/lib/server/events.js';
import '../load-env.js';
import { insertRepo } from '../../src/lib/server/db/index.js';
import {
	ingestReposFromSearch,
	shouldRunSearchFallback
} from '../../src/lib/server/repo-discovery.js';
import {
	archiveUrlForKey,
	defaultHourKey,
	GhArchiveFetchError,
	GhArchiveParseError,
	GhArchiveUnavailableError,
	parseHourKey,
	streamRepositoryCreates
} from '../../src/lib/server/gharchive.js';
import { GitHubRateLimitError } from '../../src/lib/server/github.js';

export type IngestOutcome = 'downloaded' | 'unavailable' | 'failed';
export type IngestSource = 'gharchive' | 'github_search' | 'gharchive+github_search';

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
	let ghInserted = 0;
	let ghSkipped = 0;

	const stats = await streamRepositoryCreates(url, async (event) => {
		const result = insertRepo({
			...event,
			first_seen_at: firstSeenAt,
			discovery_source: 'gharchive'
		});
		if (result.status === 'inserted' && result.id) {
			ghInserted++;
			appendRepoEvent(
				result.id,
				'first_seen',
				{
					full_name: event.full_name,
					github_url: event.github_url,
					event_id: event.event_id,
					created_at: event.created_at,
					discovery_source: 'gharchive'
				},
				firstSeenAt
			);
		} else {
			ghSkipped++;
		}
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
		retries: 0
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
