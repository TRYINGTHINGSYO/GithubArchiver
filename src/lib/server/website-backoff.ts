/** markJobFailed-shaped backoff for website verify / feed failures. */

export function websiteVerifyBackoffBaseMs(): number {
	const n = Number(process.env.WEBSITE_VERIFY_BACKOFF_BASE_MS ?? 15 * 60_000);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15 * 60_000;
}

export function computeWebsiteBackoffMs(
	consecutiveFailures: number,
	baseMs: number = websiteVerifyBackoffBaseMs()
): number {
	const failures = Math.max(1, Math.floor(consecutiveFailures));
	return Math.min(baseMs * 2 ** Math.min(failures - 1, 4), baseMs * 8);
}
