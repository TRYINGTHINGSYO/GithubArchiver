import { describe, expect, it } from 'vitest';
import { buildArchiveStoryLines, buildArchiveStoryText } from '$lib/server/archive-story';
import {
	buildArchiveStoryFacts,
	pickPrimaryCluster
} from '$lib/server/archive-story-facts';
import {
	STORY_MIN_GROWTH_PREVIOUS_WEEK,
	STORY_MIN_PERCENTILE_SAMPLE,
	type ArchiveStoryFacts
} from '$lib/server/archive-story-types';

function baseFacts(overrides: Partial<ArchiveStoryFacts> = {}): ArchiveStoryFacts {
	return {
		repoId: 1,
		createdAt: '2026-07-15T12:00:00.000Z',
		category: 'ai-project',
		interestingScore: 78,
		signalTier: 'high',
		clusters: [
			{ slug: 'ai-agents', name: 'AI Agents', confidence: 0.72, evidenceScore: 40 },
			{ slug: 'mcp-servers', name: 'MCP Servers', confidence: 0.91, evidenceScore: 62 }
		],
		primaryCluster: {
			slug: 'mcp-servers',
			name: 'MCP Servers',
			confidence: 0.91,
			evidenceScore: 62
		},
		weeklyContext: {
			weekStart: '2026-07-14T00:00:00.000Z',
			repoCount: 184,
			previousWeekCount: 114,
			growthPercent: 61.4,
			growthFromZero: false,
			surge: true
		},
		percentile: {
			withinCluster: 82,
			sampleSize: 184,
			topPercent: 18
		},
		status: {
			archived: false,
			deleted: false,
			activeAtLastCheck: true
		},
		...overrides
	};
}

describe('pickPrimaryCluster', () => {
	it('prefers higher confidence, then evidence, then specificity', () => {
		const primary = pickPrimaryCluster([
			{ slug: 'ai-agents', name: 'AI Agents', confidence: 0.72, evidenceScore: 40 },
			{ slug: 'mcp-servers', name: 'MCP Servers', confidence: 0.91, evidenceScore: 62 }
		]);
		expect(primary?.slug).toBe('mcp-servers');
	});

	it('uses registry priority when confidence and evidence tie', () => {
		const primary = pickPrimaryCluster([
			{ slug: 'ai-agents', name: 'AI Agents', confidence: 0.8, evidenceScore: 50 },
			{ slug: 'mcp-servers', name: 'MCP Servers', confidence: 0.8, evidenceScore: 50 }
		]);
		expect(primary?.slug).toBe('mcp-servers');
	});
});

describe('buildArchiveStory', () => {
	it('builds the three-sentence MCP example from facts', () => {
		const story = buildArchiveStoryText(baseFacts());
		expect(story).toContain('July 15, 2026');
		expect(story).toContain('AI project');
		expect(story).toContain('MCP Servers');
		expect(story).toContain('91% confidence');
		expect(story).toContain('184');
		expect(story).toContain('61% increase');
		expect(story).toContain('Interesting Score of 78');
		expect(story).toContain('top 18%');
	});

	it('describes zero-to-some growth without inventing a percentage', () => {
		const lines = buildArchiveStoryLines(
			baseFacts({
				weeklyContext: {
					weekStart: '2026-07-14T00:00:00.000Z',
					repoCount: 40,
					previousWeekCount: 0,
					growthPercent: null,
					growthFromZero: true,
					surge: false
				},
				percentile: undefined
			})
		);
		expect(lines[1]).toContain('after none were recorded the previous week');
		expect(lines[1]).not.toContain('%');
	});

	it('omits percentile when the weekly sample is too small', () => {
		const lines = buildArchiveStoryLines(
			baseFacts({
				percentile: {
					withinCluster: 90,
					sampleSize: STORY_MIN_PERCENTILE_SAMPLE - 1,
					topPercent: 10
				}
			})
		);
		expect(lines.some((line) => line.includes('top '))).toBe(false);
	});

	it('omits growth percent when the previous week sample is too small', () => {
		const lines = buildArchiveStoryLines(
			baseFacts({
				weeklyContext: {
					weekStart: '2026-07-14T00:00:00.000Z',
					repoCount: 12,
					previousWeekCount: STORY_MIN_GROWTH_PREVIOUS_WEEK - 1,
					growthPercent: null,
					growthFromZero: false,
					surge: false
				}
			})
		);
		expect(lines[1]).toContain('recorded 12 MCP Servers repositories that week.');
		expect(lines[1]).not.toContain('%');
	});
});

describe('buildArchiveStoryFacts', () => {
	it('exports statistical thresholds as constants', () => {
		expect(STORY_MIN_PERCENTILE_SAMPLE).toBe(20);
		expect(STORY_MIN_GROWTH_PREVIOUS_WEEK).toBe(5);
	});
});
