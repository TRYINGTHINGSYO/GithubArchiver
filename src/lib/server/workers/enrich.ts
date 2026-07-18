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
	countClaimableEnrichmentBacklog,
	countEnrichmentBacklogByTier,
	countEnrichmentByDepth,
	markEnrichmentSuccess,
	oldestClaimableEnrichmentAt,
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

// Use ENRICH_WORKER_* only. Legacy ENRICH_CONCURRENCY=6 / ENRICH_BATCH_SIZE=40 on Railway
// were pinning throughput below the continuous-queue targets.
function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw == null || raw === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}
const BATCH_SIZE = envInt('ENRICH_WORKER_BATCH_SIZE', 100);
const CONCURRENCY = envInt('ENRICH_WORKER_CONCURRENCY', 8);
const CYCLE_BUDGET_MS = Number(process.env.ENRICH_CYCLE_BUDGET_MS ?? 90_000);
const MAX_REQUESTS = Number(process.env.ENRICH_MAX_REQUESTS_PER_CYCLE ?? 400);
const RETRY_LIMIT = Number(process.env.ENRICH_RETRY_LIMIT ?? 5);
const DEEP_UPGRADE_BATCH = Number(process.env.ENRICH_DEEP_UPGRADE_BATCH ?? 20);

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

export interface EnrichCycleOptions {
	/** Accumulate into activity-bar "this run" across a multi-cycle burst. */
	completedBase?: number;
	failedBase?: number;
	shouldStop?: () => boolean;
}

export async function runEnrichCycle(opts: EnrichCycleOptions = {}): Promise<EnrichCycleResult> {
	const completedBase = opts.completedBase ?? 0;
	const failedBase = opts.failedBase ?? 0;
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
			completed: completedBase,
			failed: failedBase,
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
		completed: completedBase,
		failed: failedBase,
		remaining: countClaimableEnrichmentBacklog(),
		backlogTotal: backlogStart,
		enrichedTotal: countRepos() - countUnenriched()
	});

	let stop = false;

	await mapPool(claimed, concurrency, async (repo: EnrichmentQueueRepo) => {
		if (stop || opts.shouldStop?.()) {
			stop = true;
			return;
		}
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
			completed: completedBase + result.enriched,
			failed: failedBase + result.failed,
			remaining: countClaimableEnrichmentBacklog(),
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

	// Promote high-signal fast enrichments to deep (README) when urgent/high queue is quiet.
	const tiersNow = countEnrichmentBacklogByTier();
	if (
		!stop &&
		!result.rateLimited &&
		DEEP_UPGRADE_BATCH > 0 &&
		tiersNow.urgent + tiersNow.high === 0 &&
		Date.now() - cycleStarted < CYCLE_BUDGET_MS
	) {
		const upgrades = claimEnrichmentBatch(DEEP_UPGRADE_BATCH, `${workerId}-deep`, {
			deepUpgrade: true
		});
		for (const repo of upgrades) {
			if (Date.now() - cycleStarted > CYCLE_BUDGET_MS || shouldThrottleGitHubRequests(15)) {
				scheduleEnrichmentRetry(repo.id, 'deep upgrade deferred to next cycle', {
					status: 'retry',
					delayMs: 5_000
				});
				continue;
			}
			try {
				const enrichResult = await enrichRepo(repo, {
					level: 2,
					depth: 'deep',
					etag: repo.enrichment_etag,
					syncReleases: false,
					skipHistory: false
				});
				result.enriched++;
				result.enrichedDeep++;
				result.requests += enrichResult.requests;
				markEnrichmentSuccess(repo.id, 'deep', {
					etag: enrichResult.etag,
					httpStatus: enrichResult.httpStatus
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (err instanceof GitHubRateLimitError) {
					result.rateLimited = true;
					result.rateLimitResetAt = err.resetAt.toISOString();
					scheduleEnrichmentRetry(repo.id, message, {
						status: 'retry',
						delayMs: Math.max(err.resetAt.getTime() - Date.now(), 60_000),
						httpStatus: 403
					});
					break;
				}
				const policy = retryDelayForError(err, repo.enrichment_attempts);
				scheduleEnrichmentRetry(repo.id, message, policy);
				result.failed++;
			}
		}
	}

	// Incremental downstream for this batch: stories for newly enriched IDs, then discovery.
	if (result.enriched > 0) {
		try {
			await runArchiveStoryCycle({ maxBatches: 1, queueOnly: true, batchSize: Math.min(100, result.enriched) });
			await runDiscoveryMaterializationCycle();
		} catch {
			// Keep enrichment success even if story/discovery refresh fails.
		}
	}

	result.remaining = countClaimableEnrichmentBacklog();
	result.currentRepo = null;
	result.backlogByTier = countEnrichmentBacklogByTier();
	const elapsedMin = Math.max(1 / 60, (Date.now() - cycleStarted) / 60_000);
	const quotaAfter = getGitHubQuotaSnapshot();
	const throughputPerMin = result.enriched / elapsedMin;
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
		throughput_per_min: throughputPerMin
	});

	const claimable = countClaimableEnrichmentBacklog();
	setEnrichmentProgress({
		status: result.rateLimited ? 'rate_limited' : claimable > 0 ? 'paused' : 'idle',
		currentRepo: null,
		completed: completedBase + result.enriched,
		failed: failedBase + result.failed,
		remaining: claimable,
		backlogTotal: backlogStart,
		enrichedTotal: countRepos() - countUnenriched(),
		rateLimitResetAt: result.rateLimitResetAt
	});

	finishJobRun(jobId, result.rateLimited ? 'failed' : 'success', {
		...result,
		elapsed_ms: Date.now() - cycleStarted,
		throughput_per_min: throughputPerMin,
		claimable_remaining: claimable
	} as Record<string, unknown>);
	return result;
}

export interface EnrichBurstOptions {
	maxCycles?: number;
	/** Wall-clock drain budget (default ENRICH_BURST_MS / 10 minutes). */
	maxMs?: number;
	shouldStop?: () => boolean;
	onCycle?: (cycle: EnrichCycleResult, totals: EnrichBurstResult) => void;
}

export interface EnrichBurstResult {
	enriched: number;
	failed: number;
	planned: number;
	requests: number;
	cycles: number;
	rateLimited: boolean;
	rateLimitResetAt?: string;
	elapsedMs: number;
}

/** Drain enrichment for a wall-clock window (overnight continuous processing). */
export async function runEnrichBurst(opts: EnrichBurstOptions = {}): Promise<EnrichBurstResult> {
	const maxCycles = Math.max(1, opts.maxCycles ?? Number(process.env.ENRICH_BURST_CYCLES ?? 40));
	const maxMs = Math.max(
		5_000,
		opts.maxMs ?? Number(process.env.ENRICH_BURST_MS ?? 10 * 60_000)
	);
	const started = Date.now();
	const totals: EnrichBurstResult = {
		enriched: 0,
		failed: 0,
		planned: 0,
		requests: 0,
		cycles: 0,
		rateLimited: false,
		elapsedMs: 0
	};

	for (let i = 0; i < maxCycles; i++) {
		if (opts.shouldStop?.()) break;
		if (Date.now() - started >= maxMs) break;

		const enrich = await runEnrichCycle({
			completedBase: totals.enriched,
			failedBase: totals.failed,
			shouldStop: opts.shouldStop
		});
		totals.cycles++;
		totals.enriched += enrich.enriched;
		totals.failed += enrich.failed;
		totals.planned += enrich.planned;
		totals.requests += enrich.requests;
		opts.onCycle?.(enrich, totals);

		if (enrich.rateLimited) {
			totals.rateLimited = true;
			totals.rateLimitResetAt = enrich.rateLimitResetAt;
			break;
		}
		if (enrich.planned === 0) break;
	}

	totals.elapsedMs = Date.now() - started;
	return totals;
}

function sumEnrichJobWindow(sinceIso: string): {
	enriched: number;
	failed: number;
	requests: number;
	cycles: number;
} {
	const rows = getDb()
		.prepare(
			`SELECT detail_json FROM job_runs
			 WHERE job_type = 'enrich'
			   AND finished_at IS NOT NULL
			   AND finished_at >= ?`
		)
		.all(sinceIso) as { detail_json: string }[];
	let enriched = 0;
	let failed = 0;
	let requests = 0;
	for (const row of rows) {
		try {
			const detail = JSON.parse(row.detail_json) as Record<string, unknown>;
			enriched += Number(detail.enriched ?? 0);
			failed += Number(detail.failed ?? 0);
			requests += Number(detail.requests ?? 0);
		} catch {
			// ignore malformed detail
		}
	}
	return { enriched, failed, requests, cycles: rows.length };
}

export function getEnrichmentOpsSnapshot() {
	const depths = countEnrichmentByDepth();
	const tiers = countEnrichmentBacklogByTier();
	const quota = getGitHubQuotaSnapshot();
	const metrics = getDb().prepare('SELECT * FROM enrichment_metrics WHERE id = 1').get() as
		| Record<string, unknown>
		| undefined;
	const urgentHigh = tiers.urgent + tiers.high;
	const claimable = countClaimableEnrichmentBacklog();
	const deferred = tiers.deferred;
	const cycleThroughput = Number(metrics?.throughput_per_min ?? 0);
	const now = Date.now();
	const lastHour = sumEnrichJobWindow(new Date(now - 60 * 60_000).toISOString());
	const lastMinute = sumEnrichJobWindow(new Date(now - 60_000).toISOString());
	const hourThroughput = lastHour.enriched; // absolute count in window
	const minuteThroughput = lastMinute.enriched;
	const effectiveThroughput =
		minuteThroughput > 0 ? minuteThroughput : cycleThroughput > 0 ? cycleThroughput : hourThroughput / 60;
	const avgSecondsPerRepo =
		cycleThroughput > 0 ? Math.round((60 / cycleThroughput) * 10) / 10 : null;
	const requestsPerRepo =
		Number(metrics?.enriched_fast ?? 0) + Number(metrics?.enriched_deep ?? 0) > 0
			? Math.round(
					(Number(metrics?.requests ?? 0) /
						(Number(metrics?.enriched_fast ?? 0) + Number(metrics?.enriched_deep ?? 0))) *
						10
				) / 10
			: null;
	const oldestWaiting = oldestClaimableEnrichmentAt();
	const etaClaimableMinutes =
		effectiveThroughput > 0 ? Math.ceil(claimable / effectiveThroughput) : null;

	return {
		depths,
		tiers,
		quota,
		concurrency: Number(metrics?.concurrency ?? CONCURRENCY),
		configuredConcurrency: CONCURRENCY,
		batchSize: BATCH_SIZE,
		throughputPerMin: Math.round(effectiveThroughput * 10) / 10,
		cycleThroughputPerMin: Math.round(cycleThroughput * 10) / 10,
		enrichedLastMinute: minuteThroughput,
		enrichedLastHour: hourThroughput,
		failedLastHour: lastHour.failed,
		avgSecondsPerRepo,
		requestsPerRepo,
		claimableBacklog: claimable,
		deferredBacklog: deferred,
		totalUnenriched: countUnenriched(),
		oldestWaitingAt: oldestWaiting,
		etaUrgentHighMinutes: effectiveThroughput > 0 ? Math.ceil(urgentHigh / effectiveThroughput) : null,
		etaClaimableMinutes,
		etaAllMinutes: effectiveThroughput > 0 ? Math.ceil(countUnenriched() / effectiveThroughput) : null,
		lastCycle: metrics ?? null
	};
}
