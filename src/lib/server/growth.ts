/** Shared statistical guardrails for week-over-week (or period) growth. */

/** Previous period must have at least this many observations before a % is shown. */
export const MIN_GROWTH_PREVIOUS_COUNT = 5;

/**
 * Compute percentage growth from a previous baseline.
 * Returns null when the previous count is zero or below the minimum —
 * never invent a percentage from a zero (or tiny) baseline.
 */
export function computeGrowthPercent(
	current: number,
	previous: number,
	minPrevious: number = MIN_GROWTH_PREVIOUS_COUNT
): number | null {
	if (previous <= 0 || previous < minPrevious) return null;
	return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function isGrowthFromZero(current: number, previous: number): boolean {
	return previous === 0 && current > 0;
}
