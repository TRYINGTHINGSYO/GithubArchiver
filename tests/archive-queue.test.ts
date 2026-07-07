import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { insertArchiveSnapshot } from '$lib/server/db/archive';
import { listEnrichedReposForArchive } from '$lib/server/db/repos';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('listEnrichedReposForArchive', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('selects only enriched repos missing a source snapshot', () => {
		const db = getDb();
		const now = '2026-07-07T12:00:00.000Z';

		db.prepare(
			`INSERT INTO repos (owner, name, full_name, github_url, event_id, created_at, first_seen_at, discovery_source, enriched_at, default_branch)
			 VALUES ('needs', 'source', 'needs/source', 'https://github.com/needs/source', 'e1', ?, ?, 'github_search', ?, 'main')`
		).run(now, now, now);

		db.prepare(
			`INSERT INTO repos (owner, name, full_name, github_url, event_id, created_at, first_seen_at, discovery_source, enriched_at, default_branch)
			 VALUES ('has', 'source', 'has/source', 'https://github.com/has/source', 'e2', ?, ?, 'github_search', ?, 'main')`
		).run(now, now, now);

		const needsId = (db.prepare(`SELECT id FROM repos WHERE full_name = 'needs/source'`).get() as { id: number }).id;
		const hasId = (db.prepare(`SELECT id FROM repos WHERE full_name = 'has/source'`).get() as { id: number }).id;

		insertArchiveSnapshot({
			repo_id: hasId,
			snapshot_type: 'source',
			file_path: '/tmp/has-source.tar.gz',
			file_size: 100,
			sha256: 'abc',
			head_sha: 'deadbeef',
			archived_at: now
		});

		insertArchiveSnapshot({
			repo_id: hasId,
			snapshot_type: 'readme',
			file_path: '/tmp/has-readme.md',
			file_size: 10,
			sha256: 'def',
			head_sha: null,
			archived_at: now
		});

		const queue = listEnrichedReposForArchive(10);
		expect(queue.map((r) => r.full_name)).toEqual(['needs/source']);
		expect(queue.find((r) => r.id === needsId)).toBeTruthy();
		expect(queue.find((r) => r.id === hasId)).toBeUndefined();
	});
});
