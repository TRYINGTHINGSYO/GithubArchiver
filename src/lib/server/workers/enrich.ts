import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { finishJobRun, startJobRun, updateJobRun } from '../db/jobs.js';
import { countRepos, countUnenriched } from '../db/repos.js';
import {
	enrichRepo,
	handleEnrichmentFailed,
	handleRepoNotFound,
	type EnrichDepth
} from '../enrich.js';
import { setEnrichmentProgress } from '../enrichment-progress.js';
import {
	claimEnrichmentBatch,
	countEnrichmentBacklogByTier,
	countEnrichmentByDepth,
	markEnrichmentSuccess,
	scheduleEnrichmentRetry,
	type EnrichmentQueueRepo
} from '../enrichment-queue.js';
import { shouldDeepEnrich } from '../enrichment-priority.js';
import {
	getGitHubQuotaSnapshot,
	recommendedConcurrency,
	shouldThrottleGitHubRequests
} from '../github-quota.js';
import {
	GitHubForbiddenError,
	GitHubHttpError,
	GitHubNotFoundError,
	GitHubRateLimitError
} from '../github.js';
import { runArchiveStoryCycle } from './stories.js';
import { runDiscoveryMaterializationCycle } from './discovery.js';

const BATCH_SIZE = Number(process.env.ENRICH_BATCH_SIZE ?? 40);
const CONCURRENCY = Number(process.env.ENRICH_CONCURRENCY ?? 6);
const CYCLE_BUDGET_MS = Number(process.env.ENRICH_CYCLE_BUDGET_MS ?? 45_000);
const MAX_REQUESTS = Number(process.env.ENRICH_MAX_REQUESTS_PER_CYCLE ?? 200);
const RETRY_LIMIT = Number(process.env.ENRICH_RETRY_LIMIT ?? 5);

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms: number): number {
	return Math.round(ms * (0.85 + Math.random() * 0.3));
}

async function mapPool<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	async function worker() {
		for (;;) {
			const idx = next++;
			if (idx >= items.length) return;
			results[idx] = await fn(items[idx]);
		}
	}
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

function retryDelayForError(err: unknown, attempts: number): {
	status: 'retry' | 'deferred' | 'unavailable' | 'forbidden' | 'terminal';
	delayMs: number;
	httpStatus?: number;
} {
	if (err instanceof GitHubNotFoundError) {
		return { status: 'unavailable', delayMs: 24 * 60 * 60_000, httpStatus: 404 };
	}
	if (err instanceof GitHubRateLimitError) {
		const until = err.resetAt.getTime() - Date.now();
		return {
			status: 'retry',
			delayMs: Math.max(until, err.retryAfterSeconds ? err.retryAfterSeconds * 1000 : 60_000),
			httpStatus: 403
		};
	}
	if (err instanceof GitHubForbiddenError) {
		return { status: 'forbidden', delayMs: 7 * 24 * 60 * 60_000, httpStatus: 403 };
	}
	if (err instanceof GitHubHttpError) {
		if (err.status === 422) return { status: 'terminal', delayMs: 30 * 24 * 60 * 60_000, httpStatus: 422 };
		if (err.status >= 500) {
			return {
				status: 'retry',
				delayMs: jitter(Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempts, 5))),
				httpStatus: err.status
			};
		}
	}
	if (attempts >= RETRY_LIMIT) {
		return { status: 'deferred', delayMs: 7 * 24 * 60 * 60_000 };
	}
	return {
		status: 'retry',
		delayMs: jitter(Math.min(6 * 60 * 60_000, 15_000 * 2 ** Math.min(attempts, 6)))
	};
}

function persistEnrichmentMetrics(partial: Record<string, unknown>): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO enrichment_metrics (
		   id, cycle_started_at, cycle_finished_at, enriched_fast, enriched_deep, failed,
		   requests, avg_latency_ms, concurrency, quota_remaining, quota_reset_at,
		   throughput_per_min, updated_at
		 ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   cycle_started_at = excluded.cycle_started_at,
		   cycle_finished_at = excluded.cycle_finished_at,
		   enriched_fast = excluded.enriched_fast,
		   enriched_deep = excluded.enriched_deep,
		   failed = excluded.failed,
		   requests = excluded.requests,
		   avg_latency_ms = excluded.avg_latency_ms,
		   concurrency = excluded.concurrency,
		   quota_remaining = excluded.quota_remaining,
		   quota_reset_at = excluded.quota_reset_at,
		   throughput_per_min = excluded.throughput_per_min,
		   updated_at = excluded.updated_at`
	).run(
		partial.cycle_started_at ?? null,
		partial.cycle_finished_at ?? null,
		partial.enriched_fast ?? 0,
		partial.enriched_deep ?? 0,
		partial.failed ?? 0,
		partial.requests ?? 0,
		partial.avg_latency_ms ?? 0,
		partial.concurrency ?? 0,
		partial.quota_remaining ?? null,
		partial.quota_reset_at ?? null,
		partial.throughput_per_min ?? 0,
		now
	);
}

export interface EnrichCycleResult {
	planned: number;
	enriched: number;
	enrichedFast: number;
	enrichedDeep: number;
	failed: number;
	deleted: number;
	requests: number;
	rateLimited: boolean;
	secondaryRateLimited: boolean;
	rateLimitResetAt?: string;
	remaining: number;
	currentRepo: string | null;
	concurrency: number;
	yielded: boolean;
	backlogByTier: Record<string, number>;
}

export async function runEnrichCycle(): Promise<EnrichCycleResult> {
	const workerId = `enrich-${process.pid}-${randomUUID().slice(0, 8)}`;
	const backlogStart = countUnenriched();
	const cycleStarted = Date.now();
	const quota = getGitHubQuotaSnapshot();
	const concurrency = recommendedConcurrency(CONCURRENCY);

	const jobId = startJobRun('enrich', {
		batch_size: BATCH_SIZE,
		concurrency,
		cycle_budget_ms: CYCLE_BUDGET_MS,
		max_requests: MAX_REQUESTS,
		priority_queue: true
	});

	const result: EnrichCycleResult = {
		planned: 0,
		enriched: 0,
		enrichedFast: 0,
		enrichedDeep: 0,
		failed: 0,
		deleted: 0,
		requests: 0,
		rateLimited: false,
		secondaryRateLimited: false,
		remaining: backlogStart,
		currentRepo: null,
		concurrency,
		yielded: false,
		backlogByTier: countEnrichmentBacklogByTier()
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

	if (shouldThrottleGitHubRequests(10)) {
		result.rateLimited = true;
		result.rateLimitResetAt = quota.resetAt ?? quota.secondaryUntil ?? undefined;
		finishJobRun(jobId, 'failed', result, 'GitHub quota too low to start enrich cycle');
		return result;
	}

	const claimed = claimEnrichmentBatch(BATCH_SIZE, workerId);
	result.planned = claimed.length;

	if (claimed.length === 0) {
		finishJobRun(jobId, 'success', { ...result, message: 'no eligible repos in priority window' });
		return result;
	}

	setEnrichmentProgress({
		status: 'running',
		currentRepo: claimed[0]?.full_name ?? null,
		completed: 0,
		failed: 0,
		remaining: backlogStart,
		backlogTotal: backlogStart,
		enrichedTotal: countRepos() - countUnenriched()
	});

	let stop = false;

	await mapPool(claimed, concurrency, async (repo: EnrichmentQueueRepo) => {
		if (stop) return;
		if (Date.now() - cycleStarted > CYCLE_BUDGET_MS) {
			result.yielded = true;
			stop = true;
			scheduleEnrichmentRetry(repo.id, 'cycle budget exceeded before start', {
				status: 'retry',
				delayMs: 1_000
			});
			return;
		}
		if (result.requests >= MAX_REQUESTS || shouldThrottleGitHubRequests(15)) {
			result.yielded = true;
			stop = true;
			scheduleEnrichmentRetry(repo.id, 'request budget / quota pressure', {
				status: 'retry',
				delayMs: 30_000
			});
			return;
		}

		result.currentRepo = repo.full_name;
		updateJobRun(jobId, {
			enriched: result.enriched,
			failed: result.failed,
			current_repo: repo.full_name,
			concurrency,
			requests: result.requests
		});
		setEnrichmentProgress({
			status: 'running',
			currentRepo: repo.full_name,
			completed: result.enriched,
			failed: result.failed,
			remaining: countUnenriched(),
			backlogTotal: backlogStart,
			enrichedTotal: countRepos() - countUnenriched()
		});

		const depth: EnrichDepth = shouldDeepEnrich({
			priority: repo.enrichment_priority,
			tier: repo.enrichment_tier
		})
			? 'deep'
			: 'fast';

		try {
			const enrichResult = await enrichRepo(repo, {
				level: depth === 'deep' ? 2 : 1,
				depth,
				etag: repo.enrichment_etag,
				syncReleases: false,
				skipHistory: depth === 'fast'
			});
			result.enriched++;
			result.requests += enrichResult.requests;
			if (depth === 'deep') result.enrichedDeep++;
			else result.enrichedFast++;
			markEnrichmentSuccess(repo.id, depth, {
				etag: enrichResult.etag,
				httpStatus: enrichResult.httpStatus
			});
		} catch (err) {
			if (err instanceof GitHubNotFoundError) {
				await handleRepoNotFound(repo);
				scheduleEnrichmentRetry(repo.id, err.message, {
					status: 'unavailable',
					delayMs: 24 * 60 * 60_000,
					httpStatus: 404
				});
				result.deleted++;
				result.failed++;
			} else if (err instanceof GitHubRateLimitError) {
				result.rateLimited = true;
				result.secondaryRateLimited = err.secondary;
				result.rateLimitResetAt = err.resetAt.toISOString();
				stop = true;
				scheduleEnrichmentRetry(repo.id, err.message, {
					status: 'retry',
					delayMs: Math.max(err.resetAt.getTime() - Date.now(), 60_000),
					httpStatus: 403
				});
				result.failed++;
			} else {
				const policy = retryDelayForError(err, repo.enrichment_attempts);
				const message = err instanceof Error ? err.message : String(err);
				await handleEnrichmentFailed(repo, message);
				scheduleEnrichmentRetry(repo.id, message, policy);
				result.failed++;
			}
		}
	});

	// Incremental downstream for this batch: stories for newly enriched IDs, then discovery.
	if (result.enriched > 0) {
		try {
			await runArchiveStoryCycle({ maxBatches: 1, queueOnly: true, batchSize: Math.min(100, result.enriched) });
			await runDiscoveryMaterializationCycle();
		} catch {
			// Keep enrichment success even if story/discovery refresh fails.
		}
	}

	result.remaining = countUnenriched();
	result.currentRepo = null;
	result.backlogByTier = countEnrichmentBacklogByTier();
	const elapsedMin = Math.max(1 / 60, (Date.now() - cycleStarted) / 60_000);
	const quotaAfter = getGitHubQuotaSnapshot();
	persistEnrichmentMetrics({
		cycle_started_at: new Date(cycleStarted).toISOString(),
		cycle_finished_at: new Date().toISOString(),
		enriched_fast: result.enrichedFast,
		enriched_deep: result.enrichedDeep,
		failed: result.failed,
		requests: result.requests,
		avg_latency_ms: quotaAfter.lastLatencyMs,
		concurrency,
		quota_remaining: quotaAfter.remaining,
		quota_reset_at: quotaAfter.resetAt,
		throughput_per_min: result.enriched / elapsedMin
	});

	setEnrichmentProgress({
		status: result.rateLimited ? 'rate_limited' : result.remaining > 0 ? 'paused' : 'idle',
		currentRepo: null,
		completed: result.enriched,
		failed: result.failed,
		remaining: result.remaining,
		backlogTotal: backlogStart,
		enrichedTotal: countRepos() - countUnenriched(),
		rateLimitResetAt: result.rateLimitResetAt
	});

	finishJobRun(jobId, result.rateLimited ? 'failed' : 'success', {
		...result
	} as Record<string, unknown>);
	return result;
}

export function getEnrichmentOpsSnapshot() {
	const depths = countEnrichmentByDepth();
	const tiers = countEnrichmentBacklogByTier();
	const quota = getGitHubQuotaSnapshot();
	const metrics = getDb().prepare('SELECT * FROM enrichment_metrics WHERE id = 1').get() as
		| Record<string, unknown>
		| undefined;
	const urgentHigh = tiers.urgent + tiers.high;
	const throughput = Number(metrics?.throughput_per_min ?? 0);
	return {
		depths,
		tiers,
		quota,
		concurrency: Number(metrics?.concurrency ?? CONCURRENCY),
		throughputPerMin: throughput,
		etaUrgentHighMinutes: throughput > 0 ? Math.ceil(urgentHigh / throughput) : null,
		etaAllMinutes: throughput > 0 ? Math.ceil(countUnenriched() / throughput) : null,
		lastCycle: metrics ?? null
	};
}
