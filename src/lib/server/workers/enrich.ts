import { listUnenrichedRepos } from '../db/index.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';
import { enrichRepo, handleEnrichmentFailed, handleRepoNotFound } from '../enrich.js';
import { GitHubNotFoundError, GitHubRateLimitError } from '../github.js';

const BATCH_SIZE = Number(process.env.ENRICH_BATCH_SIZE ?? 50);
const DELAY_MS = Number(process.env.ENRICH_DELAY_MS ?? 800);
const SYNC_RELEASES = process.env.ENRICH_SYNC_RELEASES === '1';
const CREATED_FROM = process.env.ENRICH_CREATED_FROM;
const CREATED_TO = process.env.ENRICH_CREATED_TO;

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export interface EnrichCycleResult {
	planned: number;
	enriched: number;
	failed: number;
	deleted: number;
	requests: number;
	rateLimited: boolean;
	secondaryRateLimited: boolean;
	rateLimitResetAt?: string;
}

export async function runEnrichCycle(): Promise<EnrichCycleResult> {
	const pending = listUnenrichedRepos(BATCH_SIZE, {
		createdFrom: CREATED_FROM,
		createdTo: CREATED_TO
	});
	const jobId = startJobRun('enrich', {
		batch_size: BATCH_SIZE,
		planned: pending.length,
		created_from: CREATED_FROM ?? null,
		created_to: CREATED_TO ?? null
	});

	const result: EnrichCycleResult = {
		planned: pending.length,
		enriched: 0,
		failed: 0,
		deleted: 0,
		requests: 0,
		rateLimited: false,
		secondaryRateLimited: false
	};

	if (pending.length === 0) {
		finishJobRun(jobId, 'success', { ...result, message: 'no unenriched repos' });
		return result;
	}

	for (const repo of pending) {
		try {
			const enrichResult = await enrichRepo(repo, {
				level: 1,
				syncReleases: SYNC_RELEASES
			});
			result.enriched++;
			result.requests += enrichResult.requests;
			await sleep(DELAY_MS);
		} catch (err) {
			if (err instanceof GitHubNotFoundError) {
				await handleRepoNotFound(repo);
				result.deleted++;
				result.failed++;
			} else if (err instanceof GitHubRateLimitError) {
				result.rateLimited = true;
				result.secondaryRateLimited = err.secondary;
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
