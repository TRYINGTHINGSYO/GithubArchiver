import { getDb, getRepoBySlug, insertRepo } from '$lib/server/db';
import { appendRepoEvent } from '$lib/server/events';
import {
	GitHubRateLimitError,
	searchRepositories,
	type GitHubSearchRepoItem
} from '$lib/server/github';

export interface TrendingIngestResult {
	query: string;
	minStars: number;
	maxStars: number;
	pages: number;
	found: number;
	inserted: number;
	skipped: number;
	previewed: number;
	rateLimited: boolean;
	rateLimitResetAt?: string;
}

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

/** Seed list-friendly fields without marking the repo fully enriched. */
function seedSearchPreview(repoId: number, item: GitHubSearchRepoItem) {
	getDb()
		.prepare(
			`UPDATE repos
			 SET description = COALESCE(?, description),
			     language = COALESCE(?, language),
			     stars = COALESCE(?, stars),
			     watchers = COALESCE(?, watchers)
			 WHERE id = ?`
		)
		.run(
			item.description ?? null,
			item.language ?? null,
			item.stargazers_count ?? null,
			item.stargazers_count ?? null,
			repoId
		);
}

/**
 * Pull emerging repos (~100★ band) that are active but still under-the-radar —
 * not the 100k★ household names.
 */
export async function runTrendingIngestCycle(): Promise<TrendingIngestResult> {
	const minStars = Math.max(50, Number(process.env.TRENDING_MIN_STARS ?? 100));
	const maxStars = Math.max(minStars + 1, Number(process.env.TRENDING_MAX_STARS ?? 1000));
	const maxPages = Math.max(1, Math.min(10, Number(process.env.TRENDING_MAX_PAGES ?? 3)));
	const perPage = Math.max(10, Math.min(100, Number(process.env.TRENDING_PER_PAGE ?? 50)));
	const delayMs = Math.max(0, Number(process.env.TRENDING_PAGE_DELAY_MS ?? 1500));
	const pushedDays = Math.max(1, Number(process.env.TRENDING_PUSHED_DAYS ?? 14));

	const pushedSince = new Date(Date.now() - pushedDays * 86_400_000).toISOString().slice(0, 10);
	// GitHub range syntax keeps us out of mega-star territory.
	const query = `stars:${minStars}..${maxStars} pushed:>=${pushedSince}`;

	const result: TrendingIngestResult = {
		query,
		minStars,
		maxStars,
		pages: 0,
		found: 0,
		inserted: 0,
		skipped: 0,
		previewed: 0,
		rateLimited: false
	};

	const now = new Date().toISOString();

	try {
		for (let page = 1; page <= maxPages; page++) {
			// Sort by recently updated inside the emerging band, not by highest stars.
			const response = await searchRepositories(query, page, perPage, {
				sort: 'updated',
				order: 'desc'
			});
			result.pages += 1;
			result.found += response.items.length;

			for (const item of response.items) {
				const [owner, name] = item.full_name.split('/');
				if (!owner || !name) {
					result.skipped += 1;
					continue;
				}

				const stars = item.stargazers_count;
				if (stars != null && (stars < minStars || stars > maxStars)) {
					result.skipped += 1;
					continue;
				}

				const existing = getRepoBySlug(owner, name);
				if (existing) {
					result.skipped += 1;
					continue;
				}

				const insert = insertRepo({
					owner,
					name,
					full_name: item.full_name,
					github_url: item.html_url,
					event_id: `trending:${item.id}`,
					created_at: item.created_at,
					first_seen_at: now,
					discovery_source: 'trending'
				});

				if (insert.status !== 'inserted' || insert.id == null) {
					result.skipped += 1;
					continue;
				}

				result.inserted += 1;
				appendRepoEvent(insert.id, 'first_seen', {
					source: 'trending',
					full_name: item.full_name,
					stars: item.stargazers_count ?? null,
					query
				});
				seedSearchPreview(insert.id, item);
				result.previewed += 1;
			}

			if (response.items.length < perPage) break;
			if (page < maxPages && delayMs > 0) await sleep(delayMs);
		}
	} catch (err) {
		if (err instanceof GitHubRateLimitError) {
			result.rateLimited = true;
			result.rateLimitResetAt = err.resetAt.toISOString();
			return result;
		}
		throw err;
	}

	console.log(
		`  [trending] emerging ${minStars}..${maxStars}★ query="${query}" pages=${result.pages} found=${result.found} inserted=${result.inserted} skipped=${result.skipped}`
	);
	return result;
}
