import { listReposForRefresh } from '../db/index.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';
import {
	handleEnrichmentFailed,
	handleRepoNotFound,
	refreshRepo
} from '../enrich.js';
import { GitHubNotFoundError, GitHubRateLimitError } from '../github.js';

const BATCH_SIZE = Number(process.env.REFRESH_BATCH_SIZE ?? 50);
const DELAY_MS = Number(process.env.REFRESH_DELAY_MS ?? 800);

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export interface RefreshCycleResult {
	planned: number;
	refreshed: number;
	failed: number;
	metricsChanged: number;
	rateLimited: boolean;
	rateLimitResetAt?: string;
}

export async function runRefreshCycle(): Promise<RefreshCycleResult> {
	const pending = listReposForRefresh(BATCH_SIZE);
	const jobId = startJobRun('refresh', { batch_size: BATCH_SIZE, planned: pending.length });

	const result: RefreshCycleResult = {
		planned: pending.length,
		refreshed: 0,
		failed: 0,
		metricsChanged: 0,
		rateLimited: false
	};

	if (pending.length === 0) {
		finishJobRun(jobId, 'success', { ...result, message: 'no repos due for refresh' });
		return result;
	}

	for (const repo of pending) {
		try {
			const refreshResult = await refreshRepo(repo);
			result.refreshed++;
			if (refreshResult.metricsChanged) result.metricsChanged++;
			await sleep(DELAY_MS);
		} catch (err) {
			if (err instanceof GitHubNotFoundError) {
				await handleRepoNotFound(repo);
				result.failed++;
			} else if (err instanceof GitHubRateLimitError) {
				result.rateLimited = true;
				result.rateLimitResetAt = err.resetAt.toISOString();
				finishJobRun(jobId, 'failed', result, err.message);
				return result;
			} else {
				await handleEnrichmentFailed(repo, err instanceof Error ? err.message : String(err));
				result.failed++;
			}
		}
	}

	finishJobRun(jobId, 'success', result);
	return result;
}
