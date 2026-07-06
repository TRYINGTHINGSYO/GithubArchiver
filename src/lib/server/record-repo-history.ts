import {
	getLatestCommitSnapshot,
	getLatestLicenseHistory,
	getLatestTopicsHistory,
	insertCommitSnapshot,
	insertLicenseHistory,
	insertTopicsHistory,
	parseTopicsJson
} from '$lib/server/db/repo-history';
import { parseTopics } from '$lib/server/db/repos';
import type { EnrichmentData, RepoRow } from '$lib/server/db/types';
import { appendRepoEvent } from '$lib/server/events';
import { fetchBranchCommit } from '$lib/server/github';
import { normalizeTopics, topicSetDiff, topicsEqual } from '$lib/server/topics-normalize';

const HISTORY_TRACKED_FIELDS = new Set(['license', 'topics', 'default_branch']);

function priorLicense(repo: RepoRow, latest: ReturnType<typeof getLatestLicenseHistory>): string | null {
	if (latest) return latest.license;
	return repo.license ?? null;
}

function priorTopics(repo: RepoRow, latest: ReturnType<typeof getLatestTopicsHistory>): string[] {
	if (latest) return parseTopicsJson(latest.topics_json);
	return normalizeTopics(parseTopics(repo.topics));
}

/** Strip fields that emit canonical history events from generic metadata_updated. */
export function stripHistoryTrackedChanges(
	changes: Record<string, { old: unknown; new: unknown }>
): Record<string, { old: unknown; new: unknown }> {
	const filtered: Record<string, { old: unknown; new: unknown }> = {};
	for (const [key, value] of Object.entries(changes)) {
		if (!HISTORY_TRACKED_FIELDS.has(key)) {
			filtered[key] = value;
		}
	}
	return filtered;
}

/**
 * Fetch default-branch HEAD, compare license/topics/commit against latest history,
 * append rows only on change, emit canonical repository_events.
 */
export async function recordRepoHistoryChanges(
	repo: RepoRow,
	enrichment: EnrichmentData,
	observedAt: string = new Date().toISOString()
): Promise<void> {
	const branch = enrichment.default_branch ?? 'main';
	const newTopics = normalizeTopics(enrichment.topics ?? []);
	const newLicense = enrichment.license ?? null;

	try {
		const commit = await fetchBranchCommit(repo.owner, repo.name, branch);
		const latestCommit = getLatestCommitSnapshot(repo.id);
		const prevSha = latestCommit?.sha ?? null;

		if (prevSha !== commit.sha) {
			insertCommitSnapshot({
				repo_id: repo.id,
				sha: commit.sha,
				tree_sha: commit.tree_sha,
				parent_sha: commit.parent_sha,
				committed_at: commit.committed_at,
				author_name: commit.author_name,
				author_email: commit.author_email,
				default_branch: branch,
				observed_at: observedAt
			});

			appendRepoEvent(
				repo.id,
				'default_branch_updated',
				{
					sha: commit.sha,
					tree_sha: commit.tree_sha,
					parent_sha: commit.parent_sha,
					committed_at: commit.committed_at,
					default_branch: branch,
					previous_sha: prevSha
				},
				observedAt
			);
		}
	} catch {
		// Empty repos or branch access issues — skip commit snapshot
	}

	const latestLicense = getLatestLicenseHistory(repo.id);
	const prevLicense = priorLicense(repo, latestLicense);
	if (newLicense !== prevLicense) {
		insertLicenseHistory(repo.id, newLicense, observedAt);
		appendRepoEvent(
			repo.id,
			'license_changed',
			{ old: prevLicense, new: newLicense },
			observedAt
		);
	}

	const latestTopics = getLatestTopicsHistory(repo.id);
	const prevTopics = priorTopics(repo, latestTopics);
	if (!topicsEqual(prevTopics, newTopics)) {
		const { added, removed, normalized } = topicSetDiff(prevTopics, newTopics);
		insertTopicsHistory(repo.id, normalized, added, removed, observedAt);
		appendRepoEvent(
			repo.id,
			'topics_changed',
			{ old: prevTopics, new: normalized, added, removed, topics: normalized },
			observedAt
		);
	}
}
