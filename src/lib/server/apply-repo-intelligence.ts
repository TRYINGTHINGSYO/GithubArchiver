import { readFileSync } from 'node:fs';
import { getLatestReadmePath } from '$lib/server/db/archive';
import { saveRepoIntelligence } from '$lib/server/db/category-stats';
import { parseTopics } from '$lib/server/db/repos';
import type { EnrichmentData, RepoRow } from '$lib/server/db/types';
import { classifyRepo } from '$lib/server/classify-repo';
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

	const classification = classifyRepo({
		owner: repo.owner,
		name: repo.name,
		full_name: repo.full_name,
		description: enrichment.description,
		language: enrichment.language,
		topics,
		stars: enrichment.stars,
		forks: enrichment.forks,
		readmeExcerpt: excerpt
	});

	saveRepoIntelligence(repo.id, {
		summary,
		category: classification.category,
		category_confidence: classification.confidence
	});
}
