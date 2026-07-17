import { countRepos, countUnenriched, listUnenrichedRepos } from '../db/index.js';
import { finishJobRun, startJobRun, updateJobRun } from '../db/jobs.js';
import { enrichRepo, handleEnrichmentFailed, handleRepoNotFound } from '../enrich.js';
import { GitHubNotFoundError, GitHubRateLimitError } from '../github.js';
import { setEnrichmentProgress } from '../enrichment-progress.js';

const BATCH_SIZE = Number(process.env.ENRICH_BATCH_SIZE ?? 50);
const DELAY_MS = Number(process.env.ENRICH_DELAY_MS ?? 200);
const SYNC_RELEASES = process.env.ENRICH_SYNC_RELEASES === '1';
const CREATED_FROM = process.env.ENRICH_CREATED_FROM;
const CREATED_TO = process.env.ENRICH_CREATED_TO;
/**
 * Enrich continuously across daemon loops, but yield after this many repos so
 * clustering refresh, stories, and discovery materialization can run.
 */
const MAX_PER_CYCLE = Number(process.env.ENRICH_MAX_PER_CYCLE ?? 200);

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
	remaining: number;
	currentRepo: string | null;
	yielded: boolean;
}

export async function runEnrichCycle(): Promise<EnrichCycleResult> {
	const backlogStart = countUnenriched();
	const planned = Math.min(backlogStart, Math.max(BATCH_SIZE, MAX_PER_CYCLE));
	const jobId = startJobRun('enrich', {
		batch_size: BATCH_SIZE,
		planned,
		max_per_cycle: MAX_PER_CYCLE,
		created_from: CREATED_FROM ?? null,
		created_to: CREATED_TO ?? null
	});

	const result: EnrichCycleResult = {
		planned,
		enriched: 0,
		failed: 0,
		deleted: 0,
		requests: 0,
		rateLimited: false,
		secondaryRateLimited: false,
		remaining: backlogStart,
		currentRepo: null,
		yielded: false
	};

	if (backlogStart === 0) {
		setEnrichmentProgress({
			status: 'idle',
			currentRepo: null,
			completed: 0,
			failed: 0,
			remaining: 0,
			backlogTotal: 0,
			enrichedTotal: countRepos() - countUnenriched()
		});
		finishJobRun(jobId, 'success', { ...result, message: 'no unenriched repos' });
		return result;
	}

	setEnrichmentProgress({
		status: 'running',
		currentRepo: null,
		completed: 0,
		failed: 0,
		remaining: backlogStart,
		backlogTotal: backlogStart,
		enrichedTotal: countRepos() - countUnenriched()
	});

	while (result.enriched + result.failed < MAX_PER_CYCLE) {
		const pending = listUnenrichedRepos(BATCH_SIZE, {
			createdFrom: CREATED_FROM,
			createdTo: CREATED_TO
		});
		if (pending.length === 0) break;

		for (const repo of pending) {
			if (result.enriched + result.failed >= MAX_PER_CYCLE) {
				result.yielded = true;
				break;
			}

			result.currentRepo = repo.full_name;
			const remaining = countUnenriched();
			updateJobRun(jobId, {
				batch_size: BATCH_SIZE,
				planned,
				enriched: result.enriched,
				failed: result.failed,
				remaining,
				current_repo: repo.full_name,
				max_per_cycle: MAX_PER_CYCLE
			});
			setEnrichmentProgress({
				status: 'running',
				currentRepo: repo.full_name,
				completed: result.enriched,
				failed: result.failed,
				remaining,
				backlogTotal: backlogStart,
				enrichedTotal: countRepos() - countUnenriched()
			});

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
					result.remaining = countUnenriched();
					setEnrichmentProgress({
						status: 'rate_limited',
						currentRepo: repo.full_name,
						completed: result.enriched,
						failed: result.failed,
						remaining: result.remaining,
						backlogTotal: backlogStart,
						enrichedTotal: countRepos() - countUnenriched(),
						rateLimitResetAt: result.rateLimitResetAt
					});
					finishJobRun(jobId, 'failed', result, err.message);
					return result;
				} else {
					await handleEnrichmentFailed(repo, err instanceof Error ? err.message : String(err));
					result.failed++;
				}
			}
		}
	}

	result.remaining = countUnenriched();
	result.yielded = result.remaining > 0;
	result.currentRepo = null;
	setEnrichmentProgress({
		status: result.remaining > 0 ? 'paused' : 'idle',
		currentRepo: null,
		completed: result.enriched,
		failed: result.failed,
		remaining: result.remaining,
		backlogTotal: backlogStart,
		enrichedTotal: countRepos() - countUnenriched()
	});
	finishJobRun(jobId, 'success', result);
	return result;
}
