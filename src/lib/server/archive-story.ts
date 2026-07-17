import { formatCategoryLabel } from '$lib/category-labels';
import {
	ARCHIVE_STORY_POLISH_INSTRUCTIONS,
	CURRENT_STORY_VERSION,
	type ArchiveStoryFacts,
	type ArchiveStoryPolishInput,
	type ArchiveStoryResult
} from '$lib/server/archive-story-types';
import { buildArchiveStoryFacts } from '$lib/server/archive-story-facts';
import {
	getStoredArchiveStory,
	saveArchiveStory,
	type StoredArchiveStory
} from '$lib/server/db/archive-story';
import { getRepoById } from '$lib/server/db/repos';
import type { RepoRow } from '$lib/server/db/types';

export function formatArchiveStoryDate(iso: string): string {
	return new Date(iso).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	});
}

export function buildArchiveStoryLines(facts: ArchiveStoryFacts): string[] {
	const lines: string[] = [];
	const categoryLabel = formatCategoryLabel(facts.category) ?? 'Unknown';
	const created = formatArchiveStoryDate(facts.createdAt);

	if (facts.primaryCluster) {
		const confidencePct = Math.round(facts.primaryCluster.confidence * 100);
		lines.push(
			`Created on ${created}, this repository was classified as ${categoryLabel} and matched the ${facts.primaryCluster.name} cluster with ${confidencePct}% confidence.`
		);
	} else {
		lines.push(`Created on ${created}, this repository was classified as ${categoryLabel}.`);
	}

	if (facts.primaryCluster && facts.weeklyContext) {
		const clusterName = facts.primaryCluster.name;
		const count = facts.weeklyContext.repoCount;

		if (facts.weeklyContext.growthFromZero && count > 0) {
			lines.push(
				`GithubArchive+ recorded ${count.toLocaleString()} ${clusterName} repositories that week after none were recorded the previous week.`
			);
		} else {
			let weekLine = `GithubArchive+ recorded ${count.toLocaleString()} ${clusterName} repositories that week`;
			const growth = facts.weeklyContext.growthPercent;
			if (growth != null && facts.weeklyContext.previousWeekCount >= 5) {
				const direction = growth >= 0 ? 'increase' : 'decrease';
				const surge =
					facts.weeklyContext.surge && growth >= 50
						? `, a sharp ${Math.abs(growth).toFixed(0)}% ${direction}`
						: `, a ${Math.abs(growth).toFixed(0)}% ${direction}`;
				weekLine += `${surge} over the previous week`;
			}
			lines.push(`${weekLine}.`);
		}
	}

	if (
		facts.interestingScore != null &&
		facts.percentile &&
		facts.percentile.sampleSize >= 20
	) {
		const groupLabel = facts.weeklyContext
			? `${facts.weeklyContext.repoCount.toLocaleString()} repositories in that weekly group`
			: 'that cluster';
		lines.push(
			`Its Interesting Score of ${Math.round(facts.interestingScore)} places it in the top ${facts.percentile.topPercent}% of ${groupLabel}.`
		);
	}

	return lines.slice(0, 3);
}

export function buildArchiveStoryText(facts: ArchiveStoryFacts): string {
	return buildArchiveStoryLines(facts).join(' ');
}

export function buildArchiveStoryPolishInput(facts: ArchiveStoryFacts): ArchiveStoryPolishInput {
	return {
		facts,
		instructions: [...ARCHIVE_STORY_POLISH_INSTRUCTIONS]
	};
}

export function generateArchiveStory(
	repo: RepoRow,
	version = CURRENT_STORY_VERSION
): ArchiveStoryResult {
	const facts = buildArchiveStoryFacts(repo);
	const story = buildArchiveStoryText(facts);
	const generatedAt = new Date().toISOString();
	return { story, facts, version, generatedAt };
}

export function generateAndSaveArchiveStory(
	repo: RepoRow,
	version = CURRENT_STORY_VERSION
): ArchiveStoryResult {
	const result = generateArchiveStory(repo, version);
	saveArchiveStory(repo.id, result);
	return result;
}

export function getArchiveStoryForRepo(
	repoId: number,
	opts: { regenerate?: boolean; version?: number } = {}
): ArchiveStoryResult | null {
	const repo = getRepoById(repoId);
	if (!repo) return null;

	const targetVersion = opts.version ?? CURRENT_STORY_VERSION;
	if (!opts.regenerate) {
		const stored = getStoredArchiveStory(repoId);
		if (stored && stored.story_version === targetVersion && stored.story_text) {
			return storedToResult(stored);
		}
	}

	return generateAndSaveArchiveStory(repo, targetVersion);
}

function storedToResult(stored: StoredArchiveStory): ArchiveStoryResult {
	return {
		story: stored.story_text ?? '',
		facts: JSON.parse(stored.story_facts_json) as ArchiveStoryFacts,
		version: stored.story_version ?? CURRENT_STORY_VERSION,
		generatedAt: stored.story_generated_at ?? new Date().toISOString()
	};
}
