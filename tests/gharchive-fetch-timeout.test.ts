import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
	GhArchiveTimeoutError,
	ghArchiveFetchTimeoutMs,
	streamRepositoryCreates,
	withGhArchiveTimeout
} from '$lib/server/gharchive';

describe('GH Archive fetch timeout', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		delete process.env.GH_ARCHIVE_FETCH_TIMEOUT_MS;
	});

	it('reads timeout from env with sane default', () => {
		expect(ghArchiveFetchTimeoutMs()).toBe(30_000);
		process.env.GH_ARCHIVE_FETCH_TIMEOUT_MS = '45000';
		expect(ghArchiveFetchTimeoutMs()).toBe(45_000);
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
		process.env.GH_ARCHIVE_FETCH_TIMEOUT_MS = '40';
		const ndjson = Array.from({ length: 200 }, (_, i) =>
			JSON.stringify({
				id: i,
				type: 'WatchEvent',
				repo: { name: 'o/r' },
				created_at: '2026-07-24T00:00:00Z'
			})
		).join('\n');
		const gz = gzipSync(Buffer.from(ndjson));

		vi.stubGlobal(
			'fetch',
			vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
				const stream = new ReadableStream<Uint8Array>({
					async start(controller) {
						for (let offset = 0; offset < gz.length; offset += 8) {
							if (init?.signal?.aborted) {
								const err = new Error('The operation was aborted');
								err.name = 'AbortError';
								controller.error(err);
								return;
							}
							controller.enqueue(gz.subarray(offset, Math.min(offset + 8, gz.length)));
							await new Promise((r) => setTimeout(r, 8));
						}
						controller.close();
					}
				});
				return Promise.resolve(new Response(stream, { status: 200 }));
			})
		);

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
