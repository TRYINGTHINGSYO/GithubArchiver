import { readFileSync } from 'node:fs';
import { getLatestReadmePath } from '$lib/server/db/archive';
import {
	CURRENT_CLUSTER_VERSION,
	saveRepoClusterMemberships,
	setRepoClusterVersion
} from '$lib/server/db/clusters';
import { parseTopics } from '$lib/server/db/repos';
import type { EnrichmentData, RepoRow } from '$lib/server/db/types';
import { clusterRepo, type ClusterRepoInput } from '$lib/server/cluster-repo';

function readmeExcerpt(repoId: number): string | null {
	const path = getLatestReadmePath(repoId);
	if (!path) return null;
	try {
		return readFileSync(path, 'utf8').slice(0, 4000);
	} catch {
		return null;
	}
}

function buildClusterInput(repo: RepoRow, enrichment?: EnrichmentData): ClusterRepoInput {
	const topics = enrichment?.topics ?? parseTopics(repo.topics);
	return {
		owner: repo.owner,
		name: repo.name,
		full_name: repo.full_name,
		description: enrichment?.description ?? repo.description,
		language: enrichment?.language ?? repo.language,
		topics,
		category: repo.category,
		readmeExcerpt: readmeExcerpt(repo.id)
	};
}

export function applyRepoClusters(
	repo: RepoRow,
	enrichment?: EnrichmentData,
	clusterVersion = CURRENT_CLUSTER_VERSION
): string[] {
	const input = buildClusterInput(repo, enrichment);
	const matches = clusterRepo(input);
	saveRepoClusterMemberships(
		repo.id,
		matches.map((match) => ({
			slug: match.slug,
			confidence: match.confidence,
			evidence: match.evidence
		}))
	);
	setRepoClusterVersion(repo.id, clusterVersion);
	return matches.map((match) => match.slug);
}

/** Re-run clustering from existing DB state (no GitHub API call). */
export function reapplyRepoClusters(repo: RepoRow, clusterVersion = CURRENT_CLUSTER_VERSION): string[] {
	return applyRepoClusters(
		repo,
		{
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
		},
		clusterVersion
	);
}
