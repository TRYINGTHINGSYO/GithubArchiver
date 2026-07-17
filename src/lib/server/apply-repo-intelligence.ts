import { readFileSync } from 'node:fs';
import { getLatestReadmePath } from '$lib/server/db/archive';
import { saveRepoIntelligence } from '$lib/server/db/category-stats';
import { parseTopics } from '$lib/server/db/repos';
import type { EnrichmentData, RepoRow } from '$lib/server/db/types';
import { classifyRepo } from '$lib/server/classify-repo';
import { detectSignalTier, scoreRepoInteresting } from '$lib/server/score-repo';
import { summarizeRepo } from '$lib/server/summarize-repo';

function readmeExcerpt(repoId: number): string | null {
	const path = getLatestReadmePath(repoId);
	if (!path) return null;
	try {
		const text = readFileSync(path, 'utf8');
		return text.slice(0, 4000);
	} catch {
		return null;
	}
}

export function applyRepoIntelligence(repo: RepoRow, enrichment: EnrichmentData): void {
	const topics = enrichment.topics ?? parseTopics(repo.topics);
	const excerpt = readmeExcerpt(repo.id);

	const summary = summarizeRepo({
		description: enrichment.description,
		language: enrichment.language,
		topics,
		readmeExcerpt: excerpt
	});

	const classifyInput = {
		owner: repo.owner,
		name: repo.name,
		full_name: repo.full_name,
		description: enrichment.description,
		language: enrichment.language,
		topics,
		stars: enrichment.stars,
		forks: enrichment.forks,
		homepage: enrichment.homepage ?? repo.homepage,
		owner_type: enrichment.owner_type ?? repo.owner_type,
		github_archived: repo.github_archived === 1,
		readmeExcerpt: excerpt
	};

	const classification = classifyRepo(classifyInput);
	const interesting = scoreRepoInteresting({
		...classifyInput,
		pushed_at: enrichment.pushed_at ?? repo.pushed_at,
		deleted_at: repo.deleted_at
	});
	const signalTier = detectSignalTier(
		{
			...classifyInput,
			pushed_at: enrichment.pushed_at ?? repo.pushed_at,
			deleted_at: repo.deleted_at
		},
		interesting.score
	);

	saveRepoIntelligence(repo.id, {
		summary,
		category: classification.category,
		category_confidence: classification.confidence,
		interesting_score: interesting.score,
		signal_tier: signalTier
	});
}

/** Re-run classification and scoring from existing DB state (no GitHub API call). */
export function reapplyRepoIntelligence(repo: RepoRow): void {
	const enrichment: EnrichmentData = {
		default_branch: repo.default_branch,
		description: repo.description,
		language: repo.language,
		stars: repo.stars ?? 0,
		forks: repo.forks ?? 0,
		watchers: repo.watchers ?? 0,
		license: repo.license,
		topics: parseTopics(repo.topics),
		pushed_at: repo.pushed_at,
		updated_at: repo.updated_at,
		homepage: repo.homepage,
		owner_type: repo.owner_type
	};
	applyRepoIntelligence(repo, enrichment);
}
