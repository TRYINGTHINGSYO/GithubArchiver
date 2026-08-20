/**
 * Deterministic hybrid ranking for GithubArchiver semantic search.
 *
 * final_score =
 *   semantic_norm * semanticWeight
 * + lexical_norm  * lexicalWeight
 * + quality_norm  * qualityWeight
 *
 * Scores are min-max normalized within the candidate set (or 0 when constant)
 * so incompatible raw ranges (BM25 vs TurboVec similarity) never dominate by accident.
 */

export interface RankCandidate {
	id: number;
	semanticScore?: number | null;
	lexicalScore?: number | null;
	/** Archive quality: interesting_score 0–100 preferred; stars used as soft fallback. */
	interestingScore?: number | null;
	stars?: number | null;
	signalTier?: string | null;
}

export interface RankWeights {
	semanticWeight: number;
	lexicalWeight: number;
	qualityWeight: number;
}

export interface RankedCandidate extends RankCandidate {
	finalScore: number;
	semanticNorm: number;
	lexicalNorm: number;
	qualityNorm: number;
	matchReason: 'semantic' | 'lexical' | 'hybrid' | 'quality';
}

function normalizeScores(values: Array<number | null | undefined>): number[] {
	const present = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
	const nums = present.filter((v): v is number => v !== null);
	if (nums.length === 0) return values.map(() => 0);
	const min = Math.min(...nums);
	const max = Math.max(...nums);
	if (max <= min) return present.map((v) => (v === null ? 0 : 1));
	return present.map((v) => (v === null ? 0 : (v - min) / (max - min)));
}

function qualityRaw(c: RankCandidate): number {
	if (typeof c.interestingScore === 'number' && Number.isFinite(c.interestingScore)) {
		return Math.max(0, Math.min(100, c.interestingScore)) / 100;
	}
	const stars = typeof c.stars === 'number' && Number.isFinite(c.stars) ? Math.max(0, c.stars) : 0;
	// Soft log popularity so mega-star repos cannot crush meaning.
	return Math.min(1, Math.log10(stars + 1) / 5);
}

/**
 * SQLite FTS5 `bm25()` returns **negative** scores by design: more-negative
 * means a stronger lexical match (e.g. -12.7 beats -1.1).
 *
 * Convert to higher-is-better similarity for hybrid min-max normalization.
 * Do **not** clamp with Math.max(0, …) — that collapses all typical FTS5
 * scores to the same value.
 */
export function bm25ToSimilarity(bm25: number | null | undefined): number | null {
	if (typeof bm25 !== 'number' || !Number.isFinite(bm25)) return null;
	// Negate: -12.7 → 12.7, -1.1 → 1.1 (order preserved, higher = better).
	return -bm25;
}

/** Inverse of {@link bm25ToSimilarity} for callers that still expose raw fts_rank. */
export function similarityToBm25(similarity: number | null | undefined): number | null {
	if (typeof similarity !== 'number' || !Number.isFinite(similarity)) return null;
	return -similarity;
}

export function rankHybridCandidates(
	candidates: RankCandidate[],
	weights: RankWeights
): RankedCandidate[] {
	const semanticNorms = normalizeScores(candidates.map((c) => c.semanticScore));
	const lexicalNorms = normalizeScores(candidates.map((c) => c.lexicalScore));
	const qualityNorms = normalizeScores(candidates.map((c) => qualityRaw(c)));

	const sw = Math.max(0, weights.semanticWeight);
	const lw = Math.max(0, weights.lexicalWeight);
	const qw = Math.max(0, weights.qualityWeight);
	const sum = sw + lw + qw || 1;

	const ranked = candidates.map((c, i) => {
		const semanticNorm = semanticNorms[i]!;
		const lexicalNorm = lexicalNorms[i]!;
		const qualityNorm = qualityNorms[i]!;
		const finalScore =
			(semanticNorm * sw + lexicalNorm * lw + qualityNorm * qw) / sum;
		let matchReason: RankedCandidate['matchReason'] = 'hybrid';
		if (semanticNorm > 0 && lexicalNorm <= 0) matchReason = 'semantic';
		else if (lexicalNorm > 0 && semanticNorm <= 0) matchReason = 'lexical';
		else if (semanticNorm <= 0 && lexicalNorm <= 0) matchReason = 'quality';
		return {
			...c,
			finalScore,
			semanticNorm,
			lexicalNorm,
			qualityNorm,
			matchReason
		};
	});

	ranked.sort((a, b) => {
		if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
		return a.id - b.id;
	});
	return ranked;
}
