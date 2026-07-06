import { getDb } from './connection.js';
import type {
	RepoCommitSnapshotRow,
	RepoLicenseHistoryRow,
	RepoTopicsHistoryRow
} from './types.js';

export interface CommitSnapshotInsert {
	repo_id: number;
	sha: string;
	tree_sha: string | null;
	parent_sha: string | null;
	committed_at: string | null;
	author_name: string | null;
	author_email: string | null;
	default_branch: string;
	observed_at: string;
}

export function insertCommitSnapshot(row: CommitSnapshotInsert): number {
	const db = getDb();
	const result = db
		.prepare(
			`INSERT INTO repo_commit_snapshots
			 (repo_id, sha, tree_sha, parent_sha, committed_at, author_name, author_email, default_branch, observed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			row.repo_id,
			row.sha,
			row.tree_sha,
			row.parent_sha,
			row.committed_at,
			row.author_name,
			row.author_email,
			row.default_branch,
			row.observed_at
		);
	return Number(result.lastInsertRowid);
}

export function insertLicenseHistory(
	repoId: number,
	license: string | null,
	observedAt: string
): number {
	const db = getDb();
	const result = db
		.prepare(
			`INSERT INTO repo_license_history (repo_id, license, observed_at) VALUES (?, ?, ?)`
		)
		.run(repoId, license, observedAt);
	return Number(result.lastInsertRowid);
}

export function insertTopicsHistory(
	repoId: number,
	topics: string[],
	added: string[],
	removed: string[],
	observedAt: string
): number {
	const db = getDb();
	const result = db
		.prepare(
			`INSERT INTO repo_topics_history
			 (repo_id, topics_json, added_json, removed_json, observed_at)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.run(
			repoId,
			JSON.stringify(topics),
			added.length > 0 ? JSON.stringify(added) : null,
			removed.length > 0 ? JSON.stringify(removed) : null,
			observedAt
		);
	return Number(result.lastInsertRowid);
}

export function getLatestCommitSnapshot(repoId: number): RepoCommitSnapshotRow | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT * FROM repo_commit_snapshots
			 WHERE repo_id = ?
			 ORDER BY observed_at DESC, id DESC
			 LIMIT 1`
		)
		.get(repoId) as RepoCommitSnapshotRow | undefined;
	return row ?? null;
}

export function getLatestLicenseHistory(repoId: number): RepoLicenseHistoryRow | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT * FROM repo_license_history
			 WHERE repo_id = ?
			 ORDER BY observed_at DESC, id DESC
			 LIMIT 1`
		)
		.get(repoId) as RepoLicenseHistoryRow | undefined;
	return row ?? null;
}

export function getLatestTopicsHistory(repoId: number): RepoTopicsHistoryRow | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT * FROM repo_topics_history
			 WHERE repo_id = ?
			 ORDER BY observed_at DESC, id DESC
			 LIMIT 1`
		)
		.get(repoId) as RepoTopicsHistoryRow | undefined;
	return row ?? null;
}

export function getCommitSnapshotAsOf(
	repoId: number,
	asOf: string
): RepoCommitSnapshotRow | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT * FROM repo_commit_snapshots
			 WHERE repo_id = ? AND observed_at <= ?
			 ORDER BY observed_at DESC, id DESC
			 LIMIT 1`
		)
		.get(repoId, asOf) as RepoCommitSnapshotRow | undefined;
	return row ?? null;
}

export function getLicenseHistoryAsOf(
	repoId: number,
	asOf: string
): RepoLicenseHistoryRow | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT * FROM repo_license_history
			 WHERE repo_id = ? AND observed_at <= ?
			 ORDER BY observed_at DESC, id DESC
			 LIMIT 1`
		)
		.get(repoId, asOf) as RepoLicenseHistoryRow | undefined;
	return row ?? null;
}

export function getTopicsHistoryAsOf(repoId: number, asOf: string): RepoTopicsHistoryRow | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT * FROM repo_topics_history
			 WHERE repo_id = ? AND observed_at <= ?
			 ORDER BY observed_at DESC, id DESC
			 LIMIT 1`
		)
		.get(repoId, asOf) as RepoTopicsHistoryRow | undefined;
	return row ?? null;
}

export function parseTopicsJson(json: string | null): string[] {
	if (!json) return [];
	try {
		const parsed = JSON.parse(json) as unknown;
		return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
	} catch {
		return [];
	}
}
