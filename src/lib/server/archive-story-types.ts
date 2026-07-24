import type { RepoCategory } from '$lib/server/classify-repo';
import type { SignalTier } from '$lib/server/score-repo';

export const CURRENT_STORY_VERSION = 2;

export const STORY_MIN_PERCENTILE_SAMPLE = 20;
export const STORY_MIN_GROWTH_PREVIOUS_WEEK = 5;
export const STORY_MIN_LANGUAGE_SAMPLE = 20;
export const STORY_SURGE_GROWTH_PERCENT = 50;

export interface ArchiveStoryClusterRef {
	slug: string;
	name: string;
	confidence: number;
	evidenceScore?: number;
}

export interface ArchiveStoryWeeklyContext {
	weekStart: string;
	repoCount: number;
	previousWeekCount: number;
	growthPercent: number | null;
	growthFromZero: boolean;
	surge: boolean;
}

export interface ArchiveStoryPercentile {
	withinCluster: number;
	sampleSize: number;
	topPercent: number;
}

export interface ArchiveStoryLanguageContext {
	language: string;
	clusterSharePercent: number;
	sampleSize: number;
}

export interface ArchiveStoryFacts {
	repoId: number;
	createdAt: string;
	category: RepoCategory;
	interestingScore: number | null;
	signalTier: SignalTier;
	clusters: ArchiveStoryClusterRef[];
	primaryCluster?: ArchiveStoryClusterRef;
	weeklyContext?: ArchiveStoryWeeklyContext;
	percentile?: ArchiveStoryPercentile;
	languageContext?: ArchiveStoryLanguageContext;
	status: {
		archived: boolean;
		deleted: boolean;
		activeAtLastCheck: boolean;
	};
}

export interface ArchiveStoryResult {
	story: string;
	facts: ArchiveStoryFacts;
	version: number;
	generatedAt: string;
}

export interface ArchiveStoryPolishInput {
	facts: ArchiveStoryFacts;
	instructions: string[];
}

export const ARCHIVE_STORY_POLISH_INSTRUCTIONS = [
	'Use only supplied facts',
	'Do not speculate',
	'Do not call a project successful or important',
	'Preserve all numbers exactly',
	'Use two to four sentences'
] as const;
