/** Shared AbortSignal timeout for website-discovery outbound fetches. */

export class WebsiteFetchTimeoutError extends Error {
	constructor(
		public readonly url: string,
		public readonly timeoutMs: number
	) {
		super(`Website fetch timed out after ${timeoutMs}ms: ${url}`);
		this.name = 'WebsiteFetchTimeoutError';
	}
}

function isAbortError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const name = (err as { name?: string }).name;
	return name === 'AbortError' || name === 'TimeoutError';
}

export function websiteFetchTimeoutMs(envName: string, fallbackMs: number): number {
	const n = Number(process.env[envName] ?? fallbackMs);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallbackMs;
}

/**
 * fetch() with AbortSignal covering headers + body read budget.
 * Same discipline as gharchive withGhArchiveTimeout — no bare fetch.
 */
export async function fetchWithTimeout(
	url: string,
	init: RequestInit & { timeoutMs: number }
): Promise<Response> {
	const { timeoutMs, signal: outer, ...rest } = init;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onOuterAbort = () => controller.abort();
	if (outer) {
		if (outer.aborted) controller.abort();
		else outer.addEventListener('abort', onOuterAbort, { once: true });
	}
	try {
		return await fetch(url, { ...rest, signal: controller.signal });
	} catch (err) {
		if (controller.signal.aborted || isAbortError(err)) {
			throw new WebsiteFetchTimeoutError(url, timeoutMs);
		}
		throw err;
	} finally {
		clearTimeout(timer);
		outer?.removeEventListener('abort', onOuterAbort);
	}
}
