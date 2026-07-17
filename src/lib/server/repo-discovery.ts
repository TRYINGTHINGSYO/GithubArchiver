import { insertRepo } from '$lib/server/db';
import {
	completeSearchIngestStat,
	failSearchIngestStat,
	startSearchIngestStat
} from '$lib/server/db/search-ingest';
import { rollupCategoryDailyIfNeeded } from '$lib/server/db/category-stats';
import type { DiscoverySource } from '$lib/server/db/types';
import { appendRepoEvent } from '$lib/server/events';
import { parseHourKey } from '$lib/server/gharchive';
import { GitHubRateLimitError, searchRepositories } from '$lib/server/github';
import type { GitHubSearchRepoItem, GitHubSearchRepoResponse } from '$lib/server/github';
import {
	categorySearchQualifier,
	getUnderrepresentedCategories,
	pickGapCategoryForHour
} from '$lib/server/category-discovery';

const SEARCH_PER_PAGE = 100;
const SEARCH_MAX_PAGES = Number(process.env.SEARCH_MAX_PAGES ?? 10);
const SEARCH_PAGE_DELAY_MS = Number(process.env.SEARCH_PAGE_DELAY_MS ?? 2000);
const SEARCH_SHARD_MAX_DEPTH = Number(process.env.SEARCH_SHARD_MAX_DEPTH ?? 3);
const SEARCH_FALLBACK_MIN_EVENTS = Number(process.env.SEARCH_FALLBACK_MIN_EVENTS ?? 1000);

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export function createdRangeQuery(start: Date, end: Date): string {
	const from = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
	const to = end.toISOString().replace(/\.\d{3}Z$/, 'Z');
	return `created:${from}..${to}`;
}

export function hourCreatedSearchQuery(hourKey: string): string {
	const start = parseHourKey(hourKey);
	const end = hourEnd(start);
	return createdRangeQuery(start, end);
}

function hourEnd(hourStart: Date): Date {
	const end = new Date(hourStart.getTime());
	end.setUTCMinutes(59, 59, 999);
	return end;
}

/** Split [start, end] into consecutive windows of `minutes` length. */
export function splitRange(
	start: Date,
	end: Date,
	minutes: number
): { start: Date; end: Date }[] {
	const windows: { start: Date; end: Date }[] = [];
	const limit = end.getTime();
	let cursor = start.getTime();

	while (cursor <= limit) {
		const windowEnd = Math.min(cursor + minutes * 60 * 1000 - 1, limit);
		windows.push({ start: new Date(cursor), end: new Date(windowEnd) });
		cursor = windowEnd + 1;
	}
	return windows;
}

/** Window size label for this shard depth. */
function shardMinutesForDepth(depth: number): number | null {
	if (depth === 1) return 15;
	if (depth === 2) return 5;
	if (depth === 3) return 1;
	return null;
}

/** Minutes for next subdivision when current shard exceeds 1000 results. */
function nextSubdivideMinutes(depth: number): number | null {
	if (depth === 1) return 5;
	if (depth === 2) return 1;
	return null;
}

export function shouldRunSearchFallback(parsedEvents: number, repoCreates: number): boolean {
	return repoCreates === 0 && parsedEvents >= SEARCH_FALLBACK_MIN_EVENTS;
}

export interface SearchIngestResult {
	hourKey: string;
	query: string;
	totalCount: number;
	found: number;
	inserted: number;
	skipped: number;
	pages: number;
	shards: number;
	incomplete: boolean;
	repoFullNames: string[];
}

interface Accumulator {
	found: number;
	inserted: number;
	skipped: number;
	pages: number;
	shards: number;
	incomplete: boolean;
	repoFullNames: Set<string>;
}

function insertSearchItem(
	item: GitHubSearchRepoItem,
	firstSeenAt: string
): 'inserted' | 'skipped' {
	const [owner, name] = item.full_name.split('/');
	if (!owner || !name) return 'skipped';

	const result = insertRepo({
		owner,
		name,
		full_name: item.full_name,
		github_url: item.html_url,
		event_id: `github_search:${item.id}`,
		created_at: item.created_at,
		first_seen_at: firstSeenAt,
		discovery_source: 'github_search' as DiscoverySource
	});

	if (result.status === 'inserted' && result.id) {
		appendRepoEvent(
			result.id,
			'first_seen',
			{
				full_name: item.full_name,
				github_url: item.html_url,
				event_id: `github_search:${item.id}`,
				created_at: item.created_at,
				discovery_source: 'github_search'
			},
			item.created_at
		);
		return 'inserted';
	}
	return 'skipped';
}

async function paginateShard(
	hourKey: string,
	query: string,
	depth: number,
	shardMinutes: number | null,
	firstPage: GitHubSearchRepoResponse,
	acc: Accumulator
): Promise<void> {
	const statId = startSearchIngestStat({
		hourKey,
		query,
		shardDepth: depth,
		shardMinutes
	});

	const firstSeenAt = new Date().toISOString();
	let found = 0;
	let inserted = 0;
	let skipped = 0;
	let pages = 0;
	let incomplete = firstPage.incomplete_results;

	try {
		for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
			const response = page === 1 ? firstPage : await searchRepositories(query, page, SEARCH_PER_PAGE);
			pages = page;
			incomplete = incomplete || response.incomplete_results;

			if (response.items.length === 0) break;

			for (const item of response.items) {
				found++;
				acc.repoFullNames.add(item.full_name.toLowerCase());
				if (insertSearchItem(item, firstSeenAt) === 'inserted') inserted++;
				else skipped++;
			}

			if (response.items.length < SEARCH_PER_PAGE) break;
			if (page < SEARCH_MAX_PAGES) await sleep(SEARCH_PAGE_DELAY_MS);
		}

		acc.found += found;
		acc.inserted += inserted;
		acc.skipped += skipped;
		acc.pages += pages;
		acc.shards += 1;
		if (incomplete) acc.incomplete = true;

		completeSearchIngestStat(statId, {
			status: 'completed',
			totalCount: firstPage.total_count,
			incompleteResults: incomplete,
			pagesFetched: pages,
			found,
			inserted,
			skipped
		});

		console.log(
			`  [github_search] ${query}: total_count=${firstPage.total_count} found=${found} inserted=${inserted} skipped=${skipped} (${pages} page(s))`
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		failSearchIngestStat(statId, message);
		throw err;
	}
}

async function ingestTimeWindow(
	hourKey: string,
	start: Date,
	end: Date,
	depth: number,
	acc: Accumulator
): Promise<void> {
	const query = createdRangeQuery(start, end);

	try {
		const page1 = await searchRepositories(query, 1, SEARCH_PER_PAGE);

		if (page1.total_count > 1000 && depth < SEARCH_SHARD_MAX_DEPTH) {
			const minutes = nextSubdivideMinutes(depth);
			if (minutes) {
				const statId = startSearchIngestStat({
					hourKey,
					query,
					shardDepth: depth,
					shardMinutes: shardMinutesForDepth(depth)
				});
				const subWindows = splitRange(start, end, minutes);
				console.log(
					`  Search sharded because total_count=${page1.total_count} > 1000 → ${subWindows.length} x ${minutes}-min windows`
				);
				completeSearchIngestStat(statId, {
					status: 'sharded',
					totalCount: page1.total_count,
					incompleteResults: page1.incomplete_results
				});

				for (const w of subWindows) {
					await ingestTimeWindow(hourKey, w.start, w.end, depth + 1, acc);
				}
				return;
			}
		}

		if (page1.total_count > 1000 && depth >= SEARCH_SHARD_MAX_DEPTH) {
			console.warn(
				`  [github_search] ${query}: total_count=${page1.total_count} > 1000 at max shard depth — ingesting first ${SEARCH_MAX_PAGES * SEARCH_PER_PAGE} results only`
			);
		}

		await paginateShard(
			hourKey,
			query,
			depth,
			shardMinutesForDepth(depth),
			page1,
			acc
		);
	} catch (err) {
		if (err instanceof GitHubRateLimitError) throw err;
		const message = err instanceof Error ? err.message : String(err);
		console.error(`  [github_search] shard failed: ${query} — ${message}`);
		throw err;
	}
}

export async function ingestReposFromSearch(
	hourKey: string,
	opts: { includeGapSearch?: boolean } = {}
): Promise<SearchIngestResult> {
	rollupCategoryDailyIfNeeded();

	console.log(`  Search fallback started for ${hourKey}`);
	const hourStart = parseHourKey(hourKey);
	const hourEndDate = hourEnd(hourStart);
	const query = hourCreatedSearchQuery(hourKey);
	const acc: Accumulator = {
		found: 0,
		inserted: 0,
		skipped: 0,
		pages: 0,
		shards: 0,
		incomplete: false,
		repoFullNames: new Set()
	};

	const probe = await searchRepositories(query, 1, SEARCH_PER_PAGE);
	console.log(
		`  GitHub Search probe: total_count=${probe.total_count} incomplete_results=${probe.incomplete_results}`
	);

	if (probe.total_count > 1000 && SEARCH_SHARD_MAX_DEPTH >= 1) {
		console.log(
			`  Search sharded because total_count=${probe.total_count} > 1000 (splitting hour into 15-min windows)`
		);
		const windows = splitRange(hourStart, hourEndDate, 15);
		for (const w of windows) {
			await ingestTimeWindow(hourKey, w.start, w.end, 1, acc);
		}
	} else {
		await paginateShard(hourKey, query, 0, null, probe, acc);
	}

	const gaps = opts.includeGapSearch === false ? [] : getUnderrepresentedCategories();
	const gapCategory = opts.includeGapSearch === false ? null : pickGapCategoryForHour(hourKey, gaps);
	const qualifier = gapCategory ? categorySearchQualifier(gapCategory) : null;
	if (opts.includeGapSearch !== false && qualifier) {
		const gapQuery = `${hourCreatedSearchQuery(hourKey)} ${qualifier}`;
		console.log(`  Gap-aware supplementary search for underrepresented category ${gapCategory}: ${gapQuery}`);
		try {
			const gapProbe = await searchRepositories(gapQuery, 1, SEARCH_PER_PAGE);
			await paginateShard(hourKey, gapQuery, 0, null, gapProbe, acc);
		} catch (err) {
			if (err instanceof GitHubRateLimitError) throw err;
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`  Gap-aware search skipped: ${message}`);
		}
	}

	console.log(
		`  Search fallback done: found=${acc.found} inserted=${acc.inserted} skipped=${acc.skipped} shards=${acc.shards}`
	);

	return {
		hourKey,
		query,
		totalCount: probe.total_count,
		found: acc.found,
		inserted: acc.inserted,
		skipped: acc.skipped,
		pages: acc.pages,
		shards: acc.shards,
		incomplete: acc.incomplete,
		repoFullNames: [...acc.repoFullNames]
	};
}

export { SEARCH_FALLBACK_MIN_EVENTS };
