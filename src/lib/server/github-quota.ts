/**
 * Process-local GitHub rate-limit tracker.
 * Updated from response headers; used to throttle concurrency before quota hits zero.
 */

export interface GitHubQuotaSnapshot {
	remaining: number | null;
	limit: number | null;
	resetAt: string | null;
	secondaryUntil: string | null;
	lastLatencyMs: number;
	requests: number;
	successes: number;
	failures: number;
	updatedAt: string;
}

let remaining: number | null = null;
let limit: number | null = null;
let resetAt: string | null = null;
let secondaryUntil: string | null = null;
let lastLatencyMs = 0;
let requests = 0;
let successes = 0;
let failures = 0;

export function observeGitHubResponse(res: Response, latencyMs: number): void {
	requests++;
	lastLatencyMs = latencyMs;
	const rem = res.headers.get('x-ratelimit-remaining');
	const lim = res.headers.get('x-ratelimit-limit');
	const reset = res.headers.get('x-ratelimit-reset');
	if (rem != null && Number.isFinite(Number(rem))) remaining = Number(rem);
	if (lim != null && Number.isFinite(Number(lim))) limit = Number(lim);
	if (reset != null && Number.isFinite(Number(reset))) {
		resetAt = new Date(Number(reset) * 1000).toISOString();
	}
	if (res.ok) successes++;
	else failures++;
}

export function markSecondaryRateLimit(until: Date): void {
	secondaryUntil = until.toISOString();
}

export function getGitHubQuotaSnapshot(): GitHubQuotaSnapshot {
	return {
		remaining,
		limit,
		resetAt,
		secondaryUntil,
		lastLatencyMs,
		requests,
		successes,
		failures,
		updatedAt: new Date().toISOString()
	};
}

export function shouldThrottleGitHubRequests(minRemaining = 20): boolean {
	if (secondaryUntil && Date.parse(secondaryUntil) > Date.now()) return true;
	if (remaining != null && remaining <= minRemaining) return true;
	return false;
}

export function recommendedConcurrency(base: number): number {
	if (shouldThrottleGitHubRequests(50)) return 1;
	if (remaining != null && remaining < 200) return Math.min(base, 2);
	if (remaining != null && remaining < 500) return Math.min(base, Math.max(2, Math.floor(base / 2)));
	return base;
}

export function resetGitHubQuotaForTests(): void {
	remaining = null;
	limit = null;
	resetAt = null;
	secondaryUntil = null;
	lastLatencyMs = 0;
	requests = 0;
	successes = 0;
	failures = 0;
}
