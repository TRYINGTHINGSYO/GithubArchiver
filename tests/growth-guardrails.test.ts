import { describe, expect, it } from 'vitest';
import { computeGrowthPercent, isGrowthFromZero, MIN_GROWTH_PREVIOUS_COUNT } from '$lib/server/growth';
import { buildArchiveStoryLines } from '$lib/server/archive-story';
import type { ArchiveStoryFacts } from '$lib/server/archive-story-types';

describe('computeGrowthPercent', () => {
	it('never produces a percentage from a zero baseline', () => {
		expect(computeGrowthPercent(40, 0)).toBeNull();
		expect(computeGrowthPercent(1, 0)).toBeNull();
		expect(isGrowthFromZero(40, 0)).toBe(true);
	});

	it('requires the minimum previous sample before returning a percent', () => {
		expect(MIN_GROWTH_PREVIOUS_COUNT).toBe(5);
		expect(computeGrowthPercent(20, 4)).toBeNull();
		expect(computeGrowthPercent(20, 5)).toBe(300);
		expect(computeGrowthPercent(10, 5)).toBe(100);
	});

	it('archive stories describe zero-baseline growth without a percentage', () => {
		const facts: ArchiveStoryFacts = {
			repoId: 1,
			createdAt: '2026-07-15T12:00:00.000Z',
			category: 'ai-project',
			interestingScore: 70,
			signalTier: 'high',
			clusters: [{ slug: 'cv-computer-vision', name: 'CV / Computer Vision', confidence: 0.8 }],
			primaryCluster: {
				slug: 'cv-computer-vision',
				name: 'CV / Computer Vision',
				confidence: 0.8
			},
			weeklyContext: {
				weekStart: '2026-07-14T00:00:00.000Z',
				repoCount: 40,
				previousWeekCount: 0,
				growthPercent: computeGrowthPercent(40, 0),
				growthFromZero: isGrowthFromZero(40, 0),
				surge: false
			},
			status: { archived: false, deleted: false, activeAtLastCheck: true }
		};

		expect(facts.weeklyContext?.growthPercent).toBeNull();
		const lines = buildArchiveStoryLines(facts);
		expect(lines[1]).toContain('after none were recorded the previous week');
		expect(lines[1]).not.toMatch(/\d+%/);
		expect(lines[1]).not.toContain('increase');
		expect(lines[1]).not.toContain('decrease');
	});
});
