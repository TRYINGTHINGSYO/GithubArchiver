import {
	getCommitSnapshotAsOf,
	getLicenseHistoryAsOf,
	getTopicsHistoryAsOf,
	parseTopicsJson
} from '$lib/server/db/repo-history';
import { getRepoById, parseTopics } from '$lib/server/db/repos';
import type {
	RepoCommitSnapshotRow,
	RepoLicenseHistoryRow,
	RepoTopicsHistoryRow
} from '$lib/server/db/types';
import { normalizeTopics } from '$lib/server/topics-normalize';

export interface RepoState {
	repo_id: number;
	as_of: string;
	commit: RepoCommitSnapshotRow | null;
	license: RepoLicenseHistoryRow | null;
	topics: RepoTopicsHistoryRow | null;
	/** Resolved topics at as_of (history row or repos fallback). */
	topics_list: string[];
	/** Resolved license at as_of (history row or repos fallback). */
	license_value: string | null;
}

function normalizeAsOf(asOf: Date | string): string {
	return typeof asOf === 'string' ? asOf : asOf.toISOString();
}

function repoExistedAt(repo: NonNullable<ReturnType<typeof getRepoById>>, asOfIso: string): boolean {
	const anchor = repo.enriched_at ?? repo.first_seen_at;
	return anchor <= asOfIso;
}

function resolveLicenseValue(
	repoId: number,
	asOfIso: string,
	licenseRow: RepoLicenseHistoryRow | null
): string | null {
	if (licenseRow) return licenseRow.license;
	const repo = getRepoById(repoId);
	if (!repo || !repoExistedAt(repo, asOfIso)) return null;
	return repo.license ?? null;
}

function resolveTopicsList(
	repoId: number,
	asOfIso: string,
	topicsRow: RepoTopicsHistoryRow | null
): string[] {
	if (topicsRow) return parseTopicsJson(topicsRow.topics_json);
	const repo = getRepoById(repoId);
	if (!repo || !repoExistedAt(repo, asOfIso)) return [];
	return normalizeTopics(parseTopics(repo.topics));
}

/**
 * Reconstruct repository state at a point in time from append-only history tables.
 * License and topics fall back to the current `repos` row when no history exists yet.
 * v11+ will add metrics, README snapshots, files, and features here.
 */
export function getRepoState(repoId: number, asOf: Date | string): RepoState {
	const asOfIso = normalizeAsOf(asOf);
	const licenseRow = getLicenseHistoryAsOf(repoId, asOfIso);
	const topicsRow = getTopicsHistoryAsOf(repoId, asOfIso);

	return {
		repo_id: repoId,
		as_of: asOfIso,
		commit: getCommitSnapshotAsOf(repoId, asOfIso),
		license: licenseRow,
		topics: topicsRow,
		topics_list: resolveTopicsList(repoId, asOfIso, topicsRow),
		license_value: resolveLicenseValue(repoId, asOfIso, licenseRow)
	};
}

/** Current state — latest observed values at or before now. */
export function getRepoStateNow(repoId: number): RepoState {
	return getRepoState(repoId, new Date());
}
