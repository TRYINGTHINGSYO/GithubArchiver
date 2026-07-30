/**
 * Per-hour ingest failure backoff — mirrors scheduled_jobs markJobFailed:
 * base * 2^(failures-1), capped at 8x base. Default base 15m so two sticky
 * 30s timeouts stop taxing every planner cycle without shrinking the fetch ceiling.
 */

export function ingestTimeoutBackoffBaseMs(): number {
	const n = Number(process.env.INGEST_TIMEOUT_BACKOFF_BASE_MS ?? 15 * 60_000);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15 * 60_000;
}

/** Exponential backoff for consecutive hour fetch/timeout failures. */
export function computeIngestTimeoutBackoffMs(
	consecutiveFailures: number,
	baseMs: number = ingestTimeoutBackoffBaseMs()
): number {
	const failures = Math.max(1, Math.floor(consecutiveFailures));
	return Math.min(baseMs * 2 ** Math.min(failures - 1, 4), baseMs * 8);
}
