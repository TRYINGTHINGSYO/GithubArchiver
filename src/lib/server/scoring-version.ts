/** Bump when category/cluster scoring rules change meaningfully. */
export const CURRENT_SCORING_VERSION = '2026.08.1';

export type ConfidenceBand = 'strong' | 'likely' | 'uncertain' | 'review-required';

export function confidenceBand(confidence: number): ConfidenceBand {
	if (confidence >= 0.9) return 'strong';
	if (confidence >= 0.75) return 'likely';
	if (confidence >= 0.55) return 'uncertain';
	return 'review-required';
}
