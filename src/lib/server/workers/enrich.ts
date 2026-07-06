import { listUnenrichedRepos } from '../db/index.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';
import { enrichRepo, handleEnrichmentFailed, handleRepoNotFound } from '../enrich.js';
import { GitHubNotFoundError, GitHubRateLimitError } from '../github.js';

const BATCH_SIZE = Number(process.env.ENRICH_BATCH_SIZE ?? 50);
const DELAY_MS = Number(process.env.ENRICH_DELAY_MS ?? 800);

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export interface EnrichCycleResult {
	planned: number;
	enriched: number;
	failed: number;
	rateLimited: boolean;
	rateLimitResetAt?: string;
}

export async function runEnrichCycle(): Promise<EnrichCycleResult> {
	const pending = listUnenrichedRepos(BATCH_SIZE);
	const jobId = startJobRun('enrich', { batch_size: BATCH_SIZE, planned: pending.length });

	const result: EnrichCycleResult = {
		planned: pending.length,
		enriched: 0,
		failed: 0,
		rateLimited: false
	};

	if (pending.length === 0) {
		finishJobRun(jobId, 'success', { ...result, message: 'no unenriched repos' });
		return result;
	}

	for (const repo of pending) {
		try {
			await enrichRepo(repo);
			result.enriched++;
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
