import { insertRepo } from '$lib/server/db';
import type { DiscoverySource } from '$lib/server/db/types';
import { appendRepoEvent } from '$lib/server/events';
import { parseHourKey } from '$lib/server/gharchive';
import { searchRepositories } from '$lib/server/github';

const SEARCH_PER_PAGE = 100;
const SEARCH_MAX_PAGES = Number(process.env.SEARCH_MAX_PAGES ?? 10);
const SEARCH_PAGE_DELAY_MS = Number(process.env.SEARCH_PAGE_DELAY_MS ?? 2000);
const SEARCH_FALLBACK_MIN_EVENTS = Number(process.env.SEARCH_FALLBACK_MIN_EVENTS ?? 1000);

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export function hourCreatedSearchQuery(hourKey: string): string {
	const start = parseHourKey(hourKey);
	const end = new Date(start.getTime());
	end.setUTCMinutes(59, 59, 999);
	const from = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
	const to = end.toISOString().replace(/\.\d{3}Z$/, 'Z');
	return `created:${from}..${to}`;
}

export function shouldRunSearchFallback(parsedEvents: number, repoCreates: number): boolean {
	return repoCreates === 0 && parsedEvents >= SEARCH_FALLBACK_MIN_EVENTS;
}

export interface SearchIngestResult {
	hourKey: string;
	query: string;
	found: number;
	inserted: number;
	skipped: number;
	pages: number;
	incomplete: boolean;
}

export async function ingestReposFromSearch(hourKey: string): Promise<SearchIngestResult> {
	const query = hourCreatedSearchQuery(hourKey);
	const firstSeenAt = new Date().toISOString();
	let found = 0;
	let inserted = 0;
	let skipped = 0;
	let pages = 0;
	let incomplete = false;

	for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
		const response = await searchRepositories(query, page, SEARCH_PER_PAGE);
		pages = page;
		incomplete = response.incomplete_results;

		if (response.items.length === 0) break;

		for (const item of response.items) {
			found++;
			const [owner, name] = item.full_name.split('/');
			if (!owner || !name) continue;

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
				inserted++;
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
			} else {
				skipped++;
			}
		}

		if (response.items.length < SEARCH_PER_PAGE) break;
		if (page < SEARCH_MAX_PAGES) await sleep(SEARCH_PAGE_DELAY_MS);
	}

	return { hourKey, query, found, inserted, skipped, pages, incomplete };
}

export { SEARCH_FALLBACK_MIN_EVENTS };
