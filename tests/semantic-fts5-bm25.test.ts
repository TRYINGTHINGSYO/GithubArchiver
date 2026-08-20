import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb, createTestRepo } from './helpers/db';
import { saveEnrichment } from '$lib/server/db/repos';
import { getDb } from '$lib/server/db/connection';
import { indexRepoFts } from '$lib/server/db/fts';
import { bm25ToSimilarity, rankHybridCandidates } from '$lib/server/semantic/ranking';
import type { RepoRow } from '$lib/server/db/types';

describe('real FTS5 BM25 hybrid ranking', () => {
	beforeEach(() => {
		setupTestDb();
	});

	afterEach(() => {
		teardownTestDb();
	});

	it('keeps distinct real bm25() scores distinct through hybrid ranking', () => {
		const strong = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		saveEnrichment(strong.id, {
			default_branch: 'main',
			description: 'local voice assistant speech recognition wake word microphone',
			language: 'Python',
			stars: 10,
			forks: 0,
			watchers: 10,
			license: 'MIT',
			topics: ['voice-assistant', 'speech-recognition'],
			pushed_at: '2026-08-01T00:00:00.000Z',
			updated_at: '2026-08-01T00:00:00.000Z'
		});
		const weak = createTestRepo({ enriched_at: '2026-08-01T00:00:00.000Z' });
		saveEnrichment(weak.id, {
			default_branch: 'main',
			description: 'photo gallery theme',
			language: 'CSS',
			stars: 10,
			forks: 0,
			watchers: 10,
			license: 'MIT',
			topics: ['photos'],
			pushed_at: '2026-08-01T00:00:00.000Z',
			updated_at: '2026-08-01T00:00:00.000Z'
		});

		const db = getDb();
		for (const id of [strong.id, weak.id]) {
			const row = db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow;
			indexRepoFts(row);
		}

		const rows = db
			.prepare(
				`SELECT repos.id AS id, bm25(repos_fts) AS fts_rank
				 FROM repos_fts
				 JOIN repos ON repos.id = repos_fts.repo_id
				 WHERE repos_fts MATCH ?
				 ORDER BY fts_rank ASC`
			)
			.all('"voice"* "assistant"*') as Array<{ id: number; fts_rank: number }>;

		expect(rows.length).toBeGreaterThanOrEqual(1);
		const strongRow = rows.find((r) => r.id === strong.id);
		expect(strongRow).toBeTruthy();
		expect(strongRow!.fts_rank).toBeLessThan(0);

		// Ensure at least two distinct bm25 values when both match, or inject a
		// second known weaker hit by matching a shared token.
		const both = db
			.prepare(
				`SELECT repos.id AS id, bm25(repos_fts) AS fts_rank
				 FROM repos_fts
				 JOIN repos ON repos.id = repos_fts.repo_id
				 WHERE repos_fts MATCH ?
				 ORDER BY fts_rank ASC`
			)
			.all('"voice"* OR "photo"*') as Array<{ id: number; fts_rank: number }>;

		expect(both.length).toBe(2);
		expect(both[0]!.fts_rank).not.toBe(both[1]!.fts_rank);
		// FTS5: smaller (more negative) is better.
		expect(both[0]!.fts_rank).toBeLessThan(both[1]!.fts_rank);

		const sim0 = bm25ToSimilarity(both[0]!.fts_rank)!;
		const sim1 = bm25ToSimilarity(both[1]!.fts_rank)!;
		expect(sim0).toBeGreaterThan(sim1);

		const ranked = rankHybridCandidates(
			[
				{
					id: both[0]!.id,
					semanticScore: 0.5,
					lexicalScore: sim0,
					stars: 10
				},
				{
					id: both[1]!.id,
					semanticScore: 0.5,
					lexicalScore: sim1,
					stars: 10
				}
			],
			{ semanticWeight: 0, lexicalWeight: 1, qualityWeight: 0 }
		);

		expect(ranked[0]!.id).toBe(both[0]!.id);
		expect(ranked[0]!.lexicalNorm).toBeGreaterThan(ranked[1]!.lexicalNorm);
	});
});
