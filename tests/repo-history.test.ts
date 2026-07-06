import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { insertLicenseHistory } from '$lib/server/db/repo-history';
import { recordRepoHistoryChanges } from '$lib/server/record-repo-history';
import { getRepoState } from '$lib/server/repo-state';
import { normalizeTopics, topicsEqual, topicSetDiff } from '$lib/server/topics-normalize';
import {
	createTestRepo,
	eventCountsByType,
	historyCounts,
	MOCK_COMMIT,
	setupTestDb,
	teardownTestDb,
	testEnrichment
} from './helpers/db';

vi.mock('$lib/server/github', () => ({
	fetchBranchCommit: vi.fn()
}));

import { fetchBranchCommit } from '$lib/server/github';

const mockFetchBranchCommit = vi.mocked(fetchBranchCommit);

describe('topics-normalize', () => {
	it('treats reordering as equal', () => {
		expect(topicsEqual(['b', 'a'], ['a', 'b'])).toBe(true);
	});

	it('normalizes case and whitespace', () => {
		expect(normalizeTopics([' AI ', 'ai', 'LLM'])).toEqual(['ai', 'llm']);
	});

	it('computes added/removed on normalized sets', () => {
		const diff = topicSetDiff(['rust', 'go'], ['Go', 'python']);
		expect(diff.added).toEqual(['python']);
		expect(diff.removed).toEqual(['rust']);
		expect(diff.normalized).toEqual(['go', 'python']);
	});
});

describe('recordRepoHistoryChanges', () => {
	beforeEach(() => {
		setupTestDb();
		mockFetchBranchCommit.mockResolvedValue(MOCK_COMMIT);
	});

	afterEach(() => {
		teardownTestDb();
		vi.clearAllMocks();
	});

	it('creates zero new history rows when enrich runs twice with no changes', async () => {
		const repo = createTestRepo({
			license: 'MIT',
			topics: ['typescript']
		});
		const enrichment = testEnrichment({ license: 'MIT', topics: ['typescript'] });

		await recordRepoHistoryChanges(repo, enrichment, '2026-07-01T12:00:00.000Z');
		const afterFirst = historyCounts(repo.id);

		await recordRepoHistoryChanges(repo, enrichment, '2026-07-01T12:05:00.000Z');
		const afterSecond = historyCounts(repo.id);

		expect(afterFirst).toEqual(afterSecond);
		expect(afterSecond.commits).toBe(1);
		expect(afterSecond.licenses).toBe(0);
		expect(afterSecond.topics).toBe(0);
	});

	it('creates one license history row and one license_changed event on license change', async () => {
		const repo = createTestRepo({ license: 'MIT', topics: [] });
		const enrichment = testEnrichment({ license: 'Apache-2.0', topics: [] });

		await recordRepoHistoryChanges(repo, enrichment, '2026-07-01T12:00:00.000Z');

		const counts = historyCounts(repo.id);
		const events = eventCountsByType(repo.id);

		expect(counts.licenses).toBe(1);
		expect(events.license_changed).toBe(1);

		const row = getDb()
			.prepare('SELECT license FROM repo_license_history WHERE repo_id = ?')
			.get(repo.id) as { license: string };
		expect(row.license).toBe('Apache-2.0');
	});

	it('does not create topics history when only topic order changes', async () => {
		const repo = createTestRepo({
			license: 'MIT',
			topics: ['beta', 'alpha']
		});
		const enrichment = testEnrichment({
			license: 'MIT',
			topics: ['alpha', 'beta']
		});

		await recordRepoHistoryChanges(repo, enrichment, '2026-07-01T12:00:00.000Z');

		const counts = historyCounts(repo.id);
		const events = eventCountsByType(repo.id);

		expect(counts.topics).toBe(0);
		expect(events.topics_changed).toBeUndefined();
	});

	it('records topics history when the normalized topic set changes', async () => {
		const repo = createTestRepo({
			license: 'MIT',
			topics: ['alpha']
		});
		const enrichment = testEnrichment({
			license: 'MIT',
			topics: ['alpha', 'beta']
		});

		await recordRepoHistoryChanges(repo, enrichment, '2026-07-01T12:00:00.000Z');

		expect(historyCounts(repo.id).topics).toBe(1);
		expect(eventCountsByType(repo.id).topics_changed).toBe(1);
	});
});

describe('getRepoState', () => {
	beforeEach(() => {
		setupTestDb();
	});

	afterEach(() => {
		teardownTestDb();
	});

	it('returns state before and after a license change at the correct as_of boundaries', () => {
		const repo = createTestRepo({ license: 'MIT', topics: ['ai'] });

		insertLicenseHistory(repo.id, 'MIT', '2026-07-01T10:00:00.000Z');
		insertLicenseHistory(repo.id, 'Apache-2.0', '2026-07-01T14:00:00.000Z');

		const before = getRepoState(repo.id, '2026-07-01T12:00:00.000Z');
		const after = getRepoState(repo.id, '2026-07-01T15:00:00.000Z');

		expect(before.license_value).toBe('MIT');
		expect(after.license_value).toBe('Apache-2.0');
		expect(before.license?.observed_at).toBe('2026-07-01T10:00:00.000Z');
		expect(after.license?.observed_at).toBe('2026-07-01T14:00:00.000Z');
	});

	it('falls back to repos row when history is empty', () => {
		const repo = createTestRepo({
			license: 'GPL-3.0',
			topics: ['machine-learning', 'AI']
		});

		const state = getRepoState(repo.id, '2026-07-02T00:00:00.000Z');

		expect(state.license).toBeNull();
		expect(state.topics).toBeNull();
		expect(state.license_value).toBe('GPL-3.0');
		expect(state.topics_list).toEqual(['ai', 'machine-learning']);
	});
});
