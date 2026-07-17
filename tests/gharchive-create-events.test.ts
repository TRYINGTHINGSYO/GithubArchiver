import { describe, expect, it } from 'vitest';
import { isRepositoryCreateEvent, type GhArchiveEvent } from '$lib/server/gharchive';
import { shouldRunSearchFallback } from '$lib/server/repo-discovery';
import { setupTestDb, teardownTestDb } from './helpers/db';
import {
	completeSearchIngestStat,
	isHourSearchReconciled,
	startSearchIngestStat
} from '$lib/server/db/search-ingest';
import { afterEach, beforeEach } from 'vitest';

function createEvent(payload: Record<string, unknown>, repo = 'acme/demo'): GhArchiveEvent {
	return {
		id: '1',
		type: 'CreateEvent',
		repo: { name: repo },
		created_at: '2026-07-15T06:00:00Z',
		payload
	};
}

describe('GH Archive repository CreateEvent detection', () => {
	it('matches legacy ref_type=repository payloads', () => {
		expect(
			isRepositoryCreateEvent(
				createEvent({ ref_type: 'repository', ref: null, master_branch: 'main' })
			)
		).toBe(true);
	});

	it('rejects ordinary feature-branch CreateEvents', () => {
		expect(
			isRepositoryCreateEvent(
				createEvent({
					ref_type: 'branch',
					ref: 'feature/foo',
					master_branch: 'main'
				})
			)
		).toBe(false);
	});

	it('rejects tag CreateEvents', () => {
		expect(
			isRepositoryCreateEvent(
				createEvent({ ref_type: 'tag', ref: 'v1.0.0', master_branch: 'main' })
			)
		).toBe(false);
	});

	it('matches post-2025-10 default-branch CreateEvents (ref === master_branch)', () => {
		expect(
			isRepositoryCreateEvent(
				createEvent({
					ref_type: 'branch',
					ref: 'main',
					master_branch: 'main',
					description: null,
					pusher_type: 'user'
				})
			)
		).toBe(true);
		expect(
			isRepositoryCreateEvent(
				createEvent({
					ref_type: 'branch',
					ref: 'master',
					master_branch: 'master'
				})
			)
		).toBe(true);
	});
});

describe('search fallback gating', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('runs when archive matched zero creates on a busy hour', () => {
		expect(shouldRunSearchFallback(163_279, 0, '2026-07-15-06')).toBe(true);
	});

	it('does not run when archive matched repository creates', () => {
		expect(shouldRunSearchFallback(163_279, 3057, '2026-07-15-06')).toBe(false);
	});

	it('skips when a prior search pass already reconciled mostly-duplicate results', () => {
		const id = startSearchIngestStat({
			hourKey: '2026-07-15-06',
			query: 'created:...',
			shardDepth: 0,
			shardMinutes: null
		});
		completeSearchIngestStat(id, {
			status: 'completed',
			totalCount: 258,
			found: 258,
			inserted: 0,
			skipped: 258,
			pagesFetched: 3
		});
		expect(isHourSearchReconciled('2026-07-15-06')).toBe(true);
		expect(shouldRunSearchFallback(163_279, 0, '2026-07-15-06')).toBe(false);
	});
});
