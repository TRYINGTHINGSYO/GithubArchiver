import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoRow } from '$lib/server/db/types';
import {
	clearLiveMetadataRefreshDedupeForTests,
	liveMetadataRefreshDedupeSizeForTests,
	queueLiveMetadataRefreshOnView,
	shouldRefreshLiveMetadata
} from '$lib/server/repo-view-refresh';

function repo(overrides: Partial<RepoRow> = {}) {
	return {
		id: 1,
		full_name: 'acme/widgets',
		enriched_at: '2026-07-01T00:00:00.000Z',
		last_checked_at: '2026-07-01T00:00:00.000Z',
		...overrides
	} as Pick<RepoRow, 'id' | 'full_name' | 'enriched_at' | 'last_checked_at'>;
}

describe('repo detail live metadata refresh queue', () => {
	const now = Date.parse('2026-07-01T01:00:00.000Z');
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env.ENABLE_ARTIFACT_ARCHIVE;
		process.env.LIVE_REPO_REFRESH_INTERVAL_MS = String(15 * 60 * 1000);
		process.env.LIVE_REPO_REFRESH_DEDUPE_MS = String(60 * 1000);
		clearLiveMetadataRefreshDedupeForTests();
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		clearLiveMetadataRefreshDedupeForTests();
	});

	it('does not refresh when artifact archive storage is enabled', () => {
		process.env.ENABLE_ARTIFACT_ARCHIVE = '1';
		expect(shouldRefreshLiveMetadata(repo(), now)).toBe(false);
	});

	it('marks stale metadata as refreshable without needing an awaited GitHub call', () => {
		expect(shouldRefreshLiveMetadata(repo(), now)).toBe(true);
	});

	it('queues one refresh job for duplicate detail views', () => {
		const refresh = vi.fn(() => ({ queued: true, message: 'refresh started' }));
		const enrich = vi.fn(() => ({ queued: true, message: 'enrich started' }));

		const first = queueLiveMetadataRefreshOnView(repo(), now, { refresh, enrich });
		const duplicate = queueLiveMetadataRefreshOnView(repo(), now + 5_000, { refresh, enrich });

		expect(first).toMatchObject({ shouldRefresh: true, queued: true, mode: 'refresh' });
		expect(duplicate).toMatchObject({
			shouldRefresh: true,
			queued: false,
			mode: 'refresh',
			reason: 'deduped'
		});
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(enrich).not.toHaveBeenCalled();
	});

	it('queues enrichment for repos that do not have metadata yet', () => {
		const refresh = vi.fn(() => ({ queued: true, message: 'refresh started' }));
		const enrich = vi.fn(() => ({ queued: true, message: 'enrich started' }));

		const result = queueLiveMetadataRefreshOnView(
			repo({ enriched_at: null, last_checked_at: null }),
			now,
			{ refresh, enrich }
		);

		expect(result).toMatchObject({
			shouldRefresh: true,
			queued: true,
			mode: 'enrich',
			reason: 'missing_enrichment'
		});
		expect(enrich).toHaveBeenCalledTimes(1);
		expect(refresh).not.toHaveBeenCalled();
	});

	it('surfaces runner busy state without throwing into navigation', () => {
		const refresh = vi.fn(() => ({ queued: false, message: 'Busy with "pipeline"' }));
		const enrich = vi.fn(() => ({ queued: true, message: 'enrich started' }));

		const result = queueLiveMetadataRefreshOnView(repo(), now, { refresh, enrich });

		expect(result).toMatchObject({
			shouldRefresh: true,
			queued: false,
			reason: 'runner_busy',
			message: 'Busy with "pipeline"'
		});
		expect(liveMetadataRefreshDedupeSizeForTests(now)).toBe(0);
	});

	it('expires accepted refresh dedupe keys instead of suppressing refresh forever', () => {
		const refresh = vi.fn(() => ({ queued: true, message: 'refresh started' }));
		const enrich = vi.fn(() => ({ queued: true, message: 'enrich started' }));

		queueLiveMetadataRefreshOnView(repo(), now, { refresh, enrich });
		expect(liveMetadataRefreshDedupeSizeForTests(now)).toBe(1);

		const afterTtl = now + Number(process.env.LIVE_REPO_REFRESH_DEDUPE_MS) + 1;
		expect(liveMetadataRefreshDedupeSizeForTests(afterTtl)).toBe(0);
		queueLiveMetadataRefreshOnView(repo(), afterTtl, { refresh, enrich });
		expect(refresh).toHaveBeenCalledTimes(2);
	});
});
