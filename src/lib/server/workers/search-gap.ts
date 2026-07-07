import { finishJobRun, startJobRun } from '../db/jobs.js';
import { ingestReposFromSearch } from '../repo-discovery.js';
import { GitHubRateLimitError } from '../github.js';
import { defaultHourKey } from '../gharchive.js';

export interface SearchGapCycleResult {
	hourKey: string;
	inserted: number;
	found: number;
	rateLimited: boolean;
	rateLimitResetAt?: string;
}

export async function runSearchGapCycle(): Promise<SearchGapCycleResult> {
	const hourKey = defaultHourKey();
	const jobId = startJobRun('ingest', { action: 'search_gap', hour_key: hourKey });

	const result: SearchGapCycleResult = {
		hourKey,
		inserted: 0,
		found: 0,
		rateLimited: false
	};

	try {
		const search = await ingestReposFromSearch(hourKey);
		result.inserted = search.inserted;
		result.found = search.found;
		finishJobRun(jobId, 'success', { ...result, search }, undefined, 'search_gap fallback for current hour');
		return result;
	} catch (err) {
		if (err instanceof GitHubRateLimitError) {
			result.rateLimited = true;
			result.rateLimitResetAt = err.resetAt.toISOString();
			finishJobRun(jobId, 'failed', result, err.message, 'search_gap rate limited');
			return result;
		}
		const message = err instanceof Error ? err.message : String(err);
		finishJobRun(jobId, 'failed', result, message, 'search_gap failed');
		throw err;
	}
}
