import { describe, expect, it } from 'vitest';
import { bm25ToSimilarity, rankHybridCandidates } from '$lib/server/semantic/ranking';

describe('hybrid ranking', () => {
	it('produces deterministic ordering', () => {
		const candidates = [
			{ id: 1, semanticScore: 0.9, lexicalScore: 0.1, interestingScore: 10, stars: 1 },
			{ id: 2, semanticScore: 0.2, lexicalScore: 0.9, interestingScore: 90, stars: 5000 },
			{ id: 3, semanticScore: 0.8, lexicalScore: 0.8, interestingScore: 50, stars: 100 }
		];
		const a = rankHybridCandidates(candidates, {
			semanticWeight: 0.55,
			lexicalWeight: 0.35,
			qualityWeight: 0.1
		});
		const b = rankHybridCandidates(candidates, {
			semanticWeight: 0.55,
			lexicalWeight: 0.35,
			qualityWeight: 0.1
		});
		expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
		expect(a[0]!.finalScore).toBeGreaterThanOrEqual(a[1]!.finalScore);
	});

	it('does not let stars alone beat strong semantic matches', () => {
		const ranked = rankHybridCandidates(
			[
				{ id: 1, semanticScore: 1, lexicalScore: 0.1, interestingScore: 20, stars: 5 },
				{ id: 2, semanticScore: 0.05, lexicalScore: 0.1, interestingScore: 20, stars: 200000 }
			],
			{ semanticWeight: 0.55, lexicalWeight: 0.35, qualityWeight: 0.1 }
		);
		expect(ranked[0]!.id).toBe(1);
	});

	it('converts FTS5-style negative bm25 into higher-is-better similarity', () => {
		// SQLite FTS5: more-negative = better match.
		expect(bm25ToSimilarity(-12.7)!).toBeGreaterThan(bm25ToSimilarity(-1.1)!);
		expect(bm25ToSimilarity(-12.7)!).toBeCloseTo(12.7);
		expect(bm25ToSimilarity(-1.1)!).toBeCloseTo(1.1);
		// Must not collapse all negative scores to the same value.
		expect(bm25ToSimilarity(-12.7)).not.toBe(bm25ToSimilarity(-6.2));
		expect(bm25ToSimilarity(null)).toBeNull();
	});

	it('preserves lexical order when hybrid-ranking real FTS5-negative scores', () => {
		const ranked = rankHybridCandidates(
			[
				{ id: 1, semanticScore: 0.5, lexicalScore: bm25ToSimilarity(-12.7), stars: 10 },
				{ id: 2, semanticScore: 0.5, lexicalScore: bm25ToSimilarity(-1.1), stars: 10 }
			],
			{ semanticWeight: 0.0, lexicalWeight: 1.0, qualityWeight: 0.0 }
		);
		expect(ranked[0]!.id).toBe(1);
		expect(ranked[0]!.lexicalNorm).toBeGreaterThan(ranked[1]!.lexicalNorm);
	});
});
