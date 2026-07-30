import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { commitGhArchiveCreates } from '$lib/server/ingest-commit';
import type { RepoCreateEvent } from '$lib/server/gharchive';
import { setupTestDb, teardownTestDb } from './helpers/db';

function creates(n: number): RepoCreateEvent[] {
	return Array.from({ length: n }, (_, i) => ({
		owner: 'owner',
		name: `repo-${i}`,
		full_name: `owner/repo-${i}`,
		github_url: `https://github.com/owner/repo-${i}`,
		event_id: `evt-${i}`,
		created_at: '2026-07-26T18:00:00.000Z'
	}));
}

describe('commitGhArchiveCreates', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('inserts a batch of creates with first_seen events', () => {
		const result = commitGhArchiveCreates(creates(25), '2026-07-30T22:00:00.000Z');
		expect(result).toEqual({ inserted: 25, skipped: 0 });

		const repos = getDb().prepare('SELECT COUNT(*) AS c FROM repos').get() as { c: number };
		const events = getDb()
			.prepare(`SELECT COUNT(*) AS c FROM repository_events WHERE event_type = 'first_seen'`)
			.get() as { c: number };
		expect(repos.c).toBe(25);
		expect(events.c).toBe(25);
	});

	it('skips duplicates without aborting the rest of the batch', () => {
		commitGhArchiveCreates(creates(3), '2026-07-30T22:00:00.000Z');
		const second = commitGhArchiveCreates(creates(5), '2026-07-30T22:01:00.000Z');
		expect(second).toEqual({ inserted: 2, skipped: 3 });
		const repos = getDb().prepare('SELECT COUNT(*) AS c FROM repos').get() as { c: number };
		expect(repos.c).toBe(5);
	});

	// The regression this helper exists for: a mid-batch failure used to leave
	// partial inserts (UNIQUE constraint noise on retry). One transaction means
	// either the whole hour lands or none of it does.
	it('rolls back every insert when one row fails mid-batch', () => {
		getDb().exec(`
			CREATE TRIGGER fail_fifth BEFORE INSERT ON repos
			BEGIN
				SELECT CASE WHEN (SELECT COUNT(*) FROM repos) >= 4
					THEN RAISE(ABORT, 'forced mid-batch failure')
				END;
			END;
		`);

		expect(() =>
			commitGhArchiveCreates(creates(10), '2026-07-30T22:00:00.000Z')
		).toThrow(/forced mid-batch failure/);

		const repos = getDb().prepare('SELECT COUNT(*) AS c FROM repos').get() as { c: number };
		const events = getDb()
			.prepare('SELECT COUNT(*) AS c FROM repository_events')
			.get() as { c: number };
		expect(repos.c).toBe(0);
		expect(events.c).toBe(0);
	});
});
