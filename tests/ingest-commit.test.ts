import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import {
	commitGhArchiveCreateBatch,
	commitGhArchiveCreates
} from '$lib/server/ingest-commit';
import type { RepoCreateEvent } from '$lib/server/gharchive';
import { setupTestDb, teardownTestDb } from './helpers/db';

function creates(n: number, offset = 0): RepoCreateEvent[] {
	return Array.from({ length: n }, (_, i) => ({
		owner: 'owner',
		name: `repo-${offset + i}`,
		full_name: `owner/repo-${offset + i}`,
		github_url: `https://github.com/owner/repo-${offset + i}`,
		event_id: `evt-${offset + i}`,
		created_at: '2026-07-26T18:00:00.000Z'
	}));
}

describe('commitGhArchiveCreates', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('inserts a batch of creates with first_seen events', async () => {
		const result = await commitGhArchiveCreates(creates(25), '2026-07-30T22:00:00.000Z');
		expect(result).toEqual({ inserted: 25, skipped: 0 });

		const repos = getDb().prepare('SELECT COUNT(*) AS c FROM repos').get() as { c: number };
		const events = getDb()
			.prepare(`SELECT COUNT(*) AS c FROM repository_events WHERE event_type = 'first_seen'`)
			.get() as { c: number };
		expect(repos.c).toBe(25);
		expect(events.c).toBe(25);
	});

	it('skips duplicates without aborting the rest of the batch', async () => {
		await commitGhArchiveCreates(creates(3), '2026-07-30T22:00:00.000Z');
		const second = await commitGhArchiveCreates(creates(5), '2026-07-30T22:01:00.000Z');
		expect(second).toEqual({ inserted: 2, skipped: 3 });
		const repos = getDb().prepare('SELECT COUNT(*) AS c FROM repos').get() as { c: number };
		expect(repos.c).toBe(5);
	});

	// A mid-batch failure used to leave partial inserts (UNIQUE constraint noise
	// on retry). One transaction per chunk means that chunk lands wholly or not.
	it('rolls back every insert in a chunk when one row fails mid-batch', () => {
		getDb().exec(`
			CREATE TRIGGER fail_fifth BEFORE INSERT ON repos
			BEGIN
				SELECT CASE WHEN (SELECT COUNT(*) FROM repos) >= 4
					THEN RAISE(ABORT, 'forced mid-batch failure')
				END;
			END;
		`);

		expect(() =>
			commitGhArchiveCreateBatch(creates(10), '2026-07-30T22:00:00.000Z')
		).toThrow(/forced mid-batch failure/);

		const repos = getDb().prepare('SELECT COUNT(*) AS c FROM repos').get() as { c: number };
		const events = getDb()
			.prepare('SELECT COUNT(*) AS c FROM repository_events')
			.get() as { c: number };
		expect(repos.c).toBe(0);
		expect(events.c).toBe(0);
	});

	it('yields to the event loop between chunks so a wall-clock abort can fire', async () => {
		const immediate = vi.spyOn(globalThis, 'setImmediate');
		await commitGhArchiveCreates(creates(450), '2026-07-30T22:00:00.000Z', 200);
		// 450 rows / 200 = 3 chunks → 2 yields between them.
		expect(immediate).toHaveBeenCalledTimes(2);
		immediate.mockRestore();

		const repos = getDb().prepare('SELECT COUNT(*) AS c FROM repos').get() as { c: number };
		expect(repos.c).toBe(450);
	});
});
