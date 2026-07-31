import type { RepoRow } from '$lib/server/db/types';
import { runEnrichJob, runRefreshJob, type EnqueueResult } from '$lib/server/job-runner';
import { isMetadataOnlyMode } from '$lib/server/runtime-mode';

type RefreshMode = 'none' | 'enrich' | 'refresh';

export interface LiveMetadataRefreshStatus {
	shouldRefresh: boolean;
	queued: boolean;
	mode: RefreshMode;
	reason: 'metadata_storage_enabled' | 'disabled' | 'fresh' | 'missing_enrichment' | 'stale' | 'deduped' | 'runner_busy' | 'queue_error';
	message?: string;
}

interface RefreshRunner {
	enrich: () => EnqueueResult;
	refresh: () => EnqueueResult;
}

const queuedRefreshes = new Map<string, number>();
const DEFAULT_MAX_DEDUPE_KEYS = 500;

function liveRefreshIntervalMs(): number {
	return Number(process.env.LIVE_REPO_REFRESH_INTERVAL_MS ?? 15 * 60 * 1000);
}

function liveRefreshDedupeMs(): number {
	return Number(process.env.LIVE_REPO_REFRESH_DEDUPE_MS ?? 60 * 1000);
}

function maxDedupeKeys(): number {
	const parsed = Number(process.env.LIVE_REPO_REFRESH_DEDUPE_MAX_KEYS ?? DEFAULT_MAX_DEDUPE_KEYS);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_DEDUPE_KEYS;
}

function refreshKey(repo: Pick<RepoRow, 'id' | 'enriched_at'>): string {
	return `${repo.enriched_at ? 'refresh' : 'enrich'}:${repo.id}`;
}

function pruneDedupe(now: number): void {
	for (const [key, expiresAt] of queuedRefreshes) {
		if (expiresAt <= now) queuedRefreshes.delete(key);
	}

	const maxKeys = maxDedupeKeys();
	while (queuedRefreshes.size > maxKeys) {
		const oldest = queuedRefreshes.keys().next().value as string | undefined;
		if (!oldest) break;
		queuedRefreshes.delete(oldest);
	}
}

export function shouldRefreshLiveMetadata(
	repo: Pick<RepoRow, 'enriched_at' | 'last_checked_at'>,
	now = Date.now()
): boolean {
	if (!isMetadataOnlyMode()) return false;
	const interval = liveRefreshIntervalMs();
	if (interval <= 0) return false;
	if (!repo.enriched_at || !repo.last_checked_at) return true;

	const lastChecked = Date.parse(repo.last_checked_at);
	if (!Number.isFinite(lastChecked)) return true;

	return now - lastChecked >= interval;
}

export function describeLiveMetadataRefreshNeed(
	repo: Pick<RepoRow, 'enriched_at' | 'last_checked_at'>,
	now = Date.now()
): LiveMetadataRefreshStatus {
	if (!isMetadataOnlyMode()) {
		return {
			shouldRefresh: false,
			queued: false,
			mode: 'none',
			reason: 'metadata_storage_enabled'
		};
	}

	if (liveRefreshIntervalMs() <= 0) {
		return { shouldRefresh: false, queued: false, mode: 'none', reason: 'disabled' };
	}

	if (!shouldRefreshLiveMetadata(repo, now)) {
		return { shouldRefresh: false, queued: false, mode: 'none', reason: 'fresh' };
	}

	return {
		shouldRefresh: true,
		queued: false,
		mode: repo.enriched_at ? 'refresh' : 'enrich',
		reason: repo.enriched_at ? 'stale' : 'missing_enrichment'
	};
}

export function queueLiveMetadataRefreshOnView(
	repo: Pick<RepoRow, 'id' | 'full_name' | 'enriched_at' | 'last_checked_at'>,
	now = Date.now(),
	runner: RefreshRunner = { enrich: runEnrichJob, refresh: runRefreshJob }
): LiveMetadataRefreshStatus {
	const need = describeLiveMetadataRefreshNeed(repo, now);
	if (!need.shouldRefresh || need.mode === 'none') return need;

	pruneDedupe(now);

	const key = refreshKey(repo);
	const dedupeUntil = queuedRefreshes.get(key) ?? 0;
	if (dedupeUntil > now) {
		return {
			...need,
			queued: false,
			reason: 'deduped',
			message: `Refresh for ${repo.full_name} was already requested`
		};
	}

	queuedRefreshes.set(key, now + liveRefreshDedupeMs());

	try {
		const result = need.mode === 'refresh' ? runner.refresh() : runner.enrich();
		if (!result.queued) {
			queuedRefreshes.delete(key);
			return { ...need, queued: false, reason: 'runner_busy', message: result.message };
		}
		return { ...need, queued: true, message: result.message };
	} catch (err) {
		queuedRefreshes.delete(key);
		return {
			...need,
			queued: false,
			reason: 'queue_error',
			message: err instanceof Error ? err.message : String(err)
		};
	}
}

export function clearLiveMetadataRefreshDedupeForTests(): void {
	queuedRefreshes.clear();
}

export function liveMetadataRefreshDedupeSizeForTests(now = Date.now()): number {
	pruneDedupe(now);
	return queuedRefreshes.size;
}
