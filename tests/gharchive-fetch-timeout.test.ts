import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
	GhArchiveTimeoutError,
	ghArchiveFetchTimeoutMs,
	ghArchiveHourMaxMs,
	ghArchiveStallTimeoutMs,
	streamRepositoryCreates,
	withGhArchiveTimeout
} from '$lib/server/gharchive';

/** Gzipped NDJSON hour whose every line is a default-branch CreateEvent. */
function gzHour(events: number): Buffer {
	const ndjson = Array.from({ length: events }, (_, i) =>
		JSON.stringify({
			id: i,
			type: 'CreateEvent',
			repo: { name: `owner/repo-${i}` },
			payload: { ref: 'main', ref_type: 'branch', master_branch: 'main' },
			created_at: '2026-07-24T00:00:00Z'
		})
	).join('\n');
	return gzipSync(Buffer.from(ndjson));
}

/** Response whose body emits `gz` in chunks, pausing `gapMs` between them. */
function streamingResponse(gz: Buffer, chunkSize: number, gapMs: number) {
	return vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				for (let offset = 0; offset < gz.length; offset += chunkSize) {
					if (init?.signal?.aborted) {
						const err = new Error('The operation was aborted');
						err.name = 'AbortError';
						controller.error(err);
						return;
					}
					controller.enqueue(gz.subarray(offset, Math.min(offset + chunkSize, gz.length)));
					if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
				}
				controller.close();
			}
		});
		return Promise.resolve(new Response(stream, { status: 200 }));
	});
}

describe('GH Archive fetch timeout', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		delete process.env.GH_ARCHIVE_FETCH_TIMEOUT_MS;
		delete process.env.GH_ARCHIVE_STALL_TIMEOUT_MS;
		delete process.env.GH_ARCHIVE_HOUR_MAX_MS;
	});

	it('reads timeout from env with sane default', () => {
		expect(ghArchiveFetchTimeoutMs()).toBe(30_000);
		process.env.GH_ARCHIVE_FETCH_TIMEOUT_MS = '45000';
		expect(ghArchiveFetchTimeoutMs()).toBe(45_000);
	});

	it('separates the stall ceiling from the absolute hour ceiling', () => {
		expect(ghArchiveStallTimeoutMs()).toBe(30_000);
		expect(ghArchiveHourMaxMs()).toBe(900_000);
		process.env.GH_ARCHIVE_STALL_TIMEOUT_MS = '5000';
		process.env.GH_ARCHIVE_HOUR_MAX_MS = '60000';
		expect(ghArchiveStallTimeoutMs()).toBe(5_000);
		expect(ghArchiveHourMaxMs()).toBe(60_000);
	});

	// The regression this file exists for: production spent ~27s of a 30s total
	// budget parsing 172k events and inserting the repo creates they implied, so
	// every hour failed with "fetch timed out" while the transfer took ~2.5s.
	it('does not time out when onCreate is slower than the stall ceiling', async () => {
		process.env.GH_ARCHIVE_FETCH_TIMEOUT_MS = '80';
		process.env.GH_ARCHIVE_STALL_TIMEOUT_MS = '80';
		vi.stubGlobal('fetch', streamingResponse(gzHour(12), 4096, 0));

		// Total callback time (12 x 25ms = 300ms) far exceeds the 80ms ceiling.
		const seen: string[] = [];
		const stats = await streamRepositoryCreates(
			'https://data.gharchive.org/2026-07-26-5.json.gz',
			async (event) => {
				await new Promise((r) => setTimeout(r, 25));
				seen.push(event.full_name);
			}
		);

		expect(stats.repoCreates).toBe(12);
		expect(seen).toHaveLength(12);
	});

	it('still fails a genuinely stalled body so the hour enters backoff', async () => {
		process.env.GH_ARCHIVE_FETCH_TIMEOUT_MS = '500';
		process.env.GH_ARCHIVE_STALL_TIMEOUT_MS = '40';
		// 120ms between chunks with a 40ms stall ceiling: the transfer itself is stuck.
		vi.stubGlobal('fetch', streamingResponse(gzHour(200), 16, 120));

		await expect(
			streamRepositoryCreates('https://data.gharchive.org/2026-07-26-6.json.gz')
		).rejects.toMatchObject({ name: 'GhArchiveTimeoutError', timeoutMs: 40 });
	});

	it('caps a pathological hour with the absolute ceiling', async () => {
		process.env.GH_ARCHIVE_FETCH_TIMEOUT_MS = '500';
		process.env.GH_ARCHIVE_STALL_TIMEOUT_MS = '500';
		process.env.GH_ARCHIVE_HOUR_MAX_MS = '60';
		// Every chunk arrives inside the stall ceiling, so only the hour cap can stop it.
		vi.stubGlobal('fetch', streamingResponse(gzHour(400), 8, 15));

		await expect(
			streamRepositoryCreates('https://data.gharchive.org/2026-07-26-7.json.gz')
		).rejects.toMatchObject({ name: 'GhArchiveTimeoutError', timeoutMs: 60 });
	});

	it('withGhArchiveTimeout rejects with GhArchiveTimeoutError when aborted', async () => {
		vi.useFakeTimers();
		const pending = withGhArchiveTimeout('https://example.test/hour.json.gz', async (signal) => {
			await new Promise<void>((_resolve, reject) => {
				signal.addEventListener('abort', () => {
					const err = new Error('aborted');
					err.name = 'AbortError';
					reject(err);
				});
			});
			return null;
		}, 50);

		const assertion = expect(pending).rejects.toBeInstanceOf(GhArchiveTimeoutError);
		await vi.advanceTimersByTimeAsync(50);
		await assertion;
	});

	it('streamRepositoryCreates times out a hung fetch instead of hanging forever', async () => {
		process.env.GH_ARCHIVE_FETCH_TIMEOUT_MS = '30';
		vi.stubGlobal(
			'fetch',
			vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
				return new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => {
						const err = new Error('The operation was aborted');
						err.name = 'AbortError';
						reject(err);
					});
				});
			})
		);

		await expect(
			streamRepositoryCreates('https://data.gharchive.org/2026-07-24-21.json.gz')
		).rejects.toMatchObject({
			name: 'GhArchiveTimeoutError',
			timeoutMs: 30
		});
	});

	it('mid-stream abort becomes GhArchiveTimeoutError without crashing the process', async () => {
		process.env.GH_ARCHIVE_FETCH_TIMEOUT_MS = '500';
		process.env.GH_ARCHIVE_STALL_TIMEOUT_MS = '40';
		vi.stubGlobal('fetch', streamingResponse(gzHour(200), 8, 120));

		const crashes: unknown[] = [];
		const onCrash = (err: unknown) => {
			crashes.push(err);
		};
		process.on('uncaughtException', onCrash);
		process.on('unhandledRejection', onCrash);

		try {
			await expect(
				streamRepositoryCreates('https://data.gharchive.org/2026-07-25-02.json.gz')
			).rejects.toBeInstanceOf(GhArchiveTimeoutError);
			await new Promise((r) => setTimeout(r, 80));
			expect(crashes).toEqual([]);
		} finally {
			process.off('uncaughtException', onCrash);
			process.off('unhandledRejection', onCrash);
		}
	});
});
