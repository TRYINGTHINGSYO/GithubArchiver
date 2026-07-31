import { describe, expect, it } from 'vitest';
import { nearestRankPercentile } from '../src/lib/server/github-conn-trace.js';

describe('nearestRankPercentile', () => {
	it('returns 0 for empty input', () => {
		expect(nearestRankPercentile([], 50)).toBe(0);
	});

	it('computes nearest-rank p50/p95', () => {
		const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		expect(nearestRankPercentile(values, 50)).toBe(5);
		expect(nearestRankPercentile(values, 95)).toBe(10);
	});
});
