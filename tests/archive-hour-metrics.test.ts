import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
	getArchiveHourMetrics,
	recordArchiveHourMetrics,
	summarizeArchiveHourMetrics
} from '$lib/server/db/archive-hour-metrics';
import {
	streamRepositoryCreates,
	type RepoCreateEvent
} from '$lib/server/gharchive';
import { commitGhArchiveCreates } from '$lib/server/ingest-commit';
import { setupTestDb, teardownTestDb } from './helpers/db';

function gzCreateHour(events: number): Buffer {
	const ndjson = Array.from({ length: events }, (_, i) =>
		JSON.stringify({
			id: i,
			type: 'CreateEvent',
			repo: { name: `owner/repo-${i}` },
			payload: { ref: 'main', ref_type: 'branch', master_branch: 'main' },
			created_at: '2026-07-27T00:00:00Z'
		})
	).join('\n');
	return gzipSync(Buffer.from(ndjson));
}

describe('archive hour metrics', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => {
		vi.unstubAllGlobals();
		teardownTestDb();
	});

	it('persists separated fetch/parse/commit spans for a downloaded hour', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					new Response(gzCreateHour(40), {
						status: 200,
						headers: { 'content-type': 'application/gzip' }
					})
				)
			)
		);

		const creates: RepoCreateEvent[] = [];
		const stats = await streamRepositoryCreates(
			'https://data.gharchive.org/2026-07-27-00.json.gz',
			(event) => {
				creates.push(event);
			}
		);
		expect(stats.repoCreates).toBe(40);
		expect(stats.archiveFetchMs).toBeGreaterThanOrEqual(0);
		expect(stats.archiveParseMs).toBeGreaterThanOrEqual(0);

		const committed = await commitGhArchiveCreates(creates, '2026-07-30T23:00:00.000Z');
		expect(committed.inserted).toBe(40);
		expect(committed.deferred).toBe(40);
		expect(committed.batches).toBe(1);

		recordArchiveHourMetrics({
			hourKey: '2026-07-27-00',
			archiveFetchMs: stats.archiveFetchMs,
			archiveParseMs: stats.archiveParseMs,
			archiveCommitMs: committed.commitMs,
			archiveHourTotalMs: stats.archiveFetchMs + stats.archiveParseMs + committed.commitMs,
			archiveRowsCreated: committed.inserted,
			archiveRowsExisting: committed.skipped,
			archiveBatches: committed.batches,
			archiveDeferredRows: committed.deferred,
			parsedEvents: stats.parsedEvents,
			repoCreates: stats.repoCreates,
			nowMs: Date.parse('2026-07-30T12:00:00.000Z')
		});

		const row = getArchiveHourMetrics('2026-07-27-00');
		expect(row).toMatchObject({
			hour_key: '2026-07-27-00',
			archive_rows_created: 40,
			archive_rows_existing: 0,
			archive_batches: 1,
			archive_deferred_rows: 40,
			repo_creates: 40
		});
		// Frontier at 2026-07-30-11 → lag from 2026-07-27-00 is 83 hours.
		expect(row?.archive_frontier_lag_hours).toBe(83);

		const summary = summarizeArchiveHourMetrics(10);
		expect(summary.samples).toBe(1);
		expect(summary.avgRowsCreated).toBe(40);
		expect(summary.latestFrontierLagHours).toBe(83);
	});

	it('keeps fetch and parse additive and exclusive of commit', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					new Response(gzCreateHour(8), {
						status: 200
					})
				)
			)
		);

		const stats = await streamRepositoryCreates(
			'https://data.gharchive.org/2026-07-27-01.json.gz'
		);
		// Stream path must not invent a commit cost.
		expect(stats.archiveFetchMs + stats.archiveParseMs).toBeGreaterThanOrEqual(0);
		expect('archiveCommitMs' in stats).toBe(false);
	});
});
