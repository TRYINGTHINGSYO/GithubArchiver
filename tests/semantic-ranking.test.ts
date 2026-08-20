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

	it('converts bm25 lower-is-better into similarity', () => {
		expect(bm25ToSimilarity(0)!).toBeGreaterThan(bm25ToSimilarity(10)!);
		expect(bm25ToSimilarity(null)).toBeNull();
	});
});
