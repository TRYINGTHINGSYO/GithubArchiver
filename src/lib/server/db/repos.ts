import { getDb } from './connection';
import { indexRepoFtsById, searchReposFts } from './fts';
import { buildRepoFilters, buildRepoOrderBy } from './repo-query';
import type {
	EnrichmentData,
	NewRepo,
	RepoQuery,
	RepoQueryResult,
	RepoRow
} from './types';

export function parseTopics(topics: string | null): string[] {
	if (!topics) return [];
	try {
		return JSON.parse(topics) as string[];
	} catch {
		return [];
	}
}

export function insertRepo(repo: NewRepo): { status: 'inserted' | 'skipped'; id?: number } {
	const database = getDb();
	const source = repo.discovery_source ?? 'gharchive';
	const result = database
		.prepare(
			`INSERT OR IGNORE INTO repos
			 (owner, name, full_name, github_url, event_id, created_at, first_seen_at, discovery_source)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			repo.owner,
			repo.name,
			repo.full_name,
			repo.github_url,
			repo.event_id,
			repo.created_at,
			repo.first_seen_at,
			source
		);
	if (result.changes > 0) {
		const id = Number(result.lastInsertRowid);
		indexRepoFtsById(id);
		return { status: 'inserted', id };
	}
	return { status: 'skipped' };
}

export function getRepoBySlug(owner: string, name: string): RepoRow | null {
	const database = getDb();
	const direct = database
		.prepare('SELECT * FROM repos WHERE owner = ? AND name = ?')
		.get(owner, name) as RepoRow | undefined;
	if (direct) return direct;

	const fullName = `${owner}/${name}`;
	const alias = database
		.prepare(
			`SELECT r.* FROM repos r
			 JOIN repo_aliases a ON a.repo_id = r.id
			 WHERE a.old_full_name = ?`
		)
		.get(fullName) as RepoRow | undefined;
	return alias ?? null;
}

export function listUnenrichedRepos(limit: number): RepoRow[] {
	const database = getDb();
	return database
		.prepare(
			`SELECT * FROM repos WHERE enriched_at IS NULL AND deleted_at IS NULL
			 ORDER BY first_seen_at DESC LIMIT ?`
		)
		.all(limit) as RepoRow[];
}

export function saveEnrichment(id: number, data: EnrichmentData): void {
	const database = getDb();
	const now = new Date().toISOString();
	database
		.prepare(
			`UPDATE repos SET
				default_branch = ?,
				description = ?,
				language = ?,
				stars = ?,
				forks = ?,
				watchers = ?,
				open_issues = ?,
				size = ?,
				homepage = ?,
				visibility = ?,
				owner_avatar_url = ?,
				owner_type = ?,
				license = ?,
				topics = ?,
				pushed_at = ?,
				updated_at = ?,
				enriched_at = COALESCE(enriched_at, ?),
				last_checked_at = ?
			WHERE id = ?`
		)
		.run(
			data.default_branch,
			data.description,
			data.language,
			data.stars,
			data.forks,
			data.watchers,
			data.open_issues ?? null,
			data.size ?? null,
			data.homepage ?? null,
			data.visibility ?? null,
			data.owner_avatar_url ?? null,
			data.owner_type ?? null,
			data.license,
			JSON.stringify(data.topics),
			data.pushed_at,
			data.updated_at,
			now,
			now,
			id
		);
	indexRepoFtsById(id);
}

export function saveRefreshUpdate(id: number, data: EnrichmentData): void {
	const database = getDb();
	const now = new Date().toISOString();
	database
		.prepare(
			`UPDATE repos SET
				default_branch = ?,
				description = ?,
				language = ?,
				stars = ?,
				forks = ?,
				watchers = ?,
				open_issues = ?,
				size = ?,
				homepage = ?,
				visibility = ?,
				owner_avatar_url = ?,
				owner_type = ?,
				license = ?,
				topics = ?,
				pushed_at = ?,
				updated_at = ?,
				last_checked_at = ?
			WHERE id = ?`
		)
		.run(
			data.default_branch,
			data.description,
			data.language,
			data.stars,
			data.forks,
			data.watchers,
			data.open_issues ?? null,
			data.size ?? null,
			data.homepage ?? null,
			data.visibility ?? null,
			data.owner_avatar_url ?? null,
			data.owner_type ?? null,
			data.license,
			JSON.stringify(data.topics),
			data.pushed_at,
			data.updated_at,
			now,
			id
		);
	indexRepoFtsById(id);
}

const REFRESH_INTERVAL_HOURS = Number(process.env.REFRESH_INTERVAL_HOURS ?? 24);

export function listReposForRefresh(limit: number): RepoRow[] {
	const database = getDb();
	return database
		.prepare(
			`SELECT * FROM repos
			 WHERE enriched_at IS NOT NULL
			   AND deleted_at IS NULL
			   AND (last_checked_at IS NULL OR last_checked_at <= datetime('now', ?))
			 ORDER BY last_checked_at ASC, enriched_at ASC
			 LIMIT ?`
		)
		.all(`-${REFRESH_INTERVAL_HOURS} hours`, limit) as RepoRow[];
}

export function countReposDueForRefresh(): number {
	const database = getDb();
	return (
		database
			.prepare(
				`SELECT COUNT(*) as c FROM repos
				 WHERE enriched_at IS NOT NULL
				   AND deleted_at IS NULL
				   AND (last_checked_at IS NULL OR last_checked_at <= datetime('now', ?))`
			)
			.get(`-${REFRESH_INTERVAL_HOURS} hours`) as { c: number }
	).c;
}

export function listLanguages(): string[] {
	const database = getDb();
	const rows = database
		.prepare(
			`SELECT DISTINCT language FROM repos
			 WHERE language IS NOT NULL AND language != ''
			 ORDER BY language`
		)
		.all() as { language: string }[];
	return rows.map((r) => r.language);
}

export function queryRepos(opts: RepoQuery): RepoQueryResult {
	if (opts.q?.trim()) {
		return searchReposFts(opts);
	}

	const database = getDb();
	const page = Math.max(1, opts.page ?? 1);
	const perPage = Math.min(Math.max(1, opts.perPage ?? 50), 100);
	const offset = (page - 1) * perPage;

	const { clause, params } = buildRepoFilters(opts);
	const orderBy = buildRepoOrderBy(opts);

	const total = (
		database.prepare(`SELECT COUNT(*) as c FROM repos ${clause}`).get(...params) as { c: number }
	).c;

	const repos = database
		.prepare(`SELECT * FROM repos ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
		.all(...params, perPage, offset) as RepoRow[];

	return {
		repos,
		total,
		page,
		perPage,
		totalPages: Math.max(1, Math.ceil(total / perPage))
	};
}

export function countRepos(): number {
	const database = getDb();
	return (database.prepare('SELECT COUNT(*) as c FROM repos').get() as { c: number }).c;
}

export function countUnenriched(): number {
	const database = getDb();
	return (database.prepare('SELECT COUNT(*) as c FROM repos WHERE enriched_at IS NULL').get() as {
		c: number;
	}).c;
}

export function markRepoDeleted(id: number): void {
	const database = getDb();
	const now = new Date().toISOString();
	database.prepare('UPDATE repos SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, id);
}

export function recordRepoRename(
	repoId: number,
	oldFullName: string,
	newFullName: string,
	newOwner: string,
	newName: string
): void {
	const database = getDb();
	const now = new Date().toISOString();
	database
		.prepare(
			`INSERT OR IGNORE INTO repo_aliases (repo_id, old_full_name, new_full_name, renamed_at)
			 VALUES (?, ?, ?, ?)`
		)
		.run(repoId, oldFullName, newFullName, now);
	database
		.prepare(
			`UPDATE repos SET owner = ?, name = ?, full_name = ?, github_url = ? WHERE id = ?`
		)
		.run(newOwner, newName, newFullName, `https://github.com/${newFullName}`, repoId);
	indexRepoFtsById(repoId);
}

export function getRepoById(id: number): RepoRow | null {
	const database = getDb();
	const row = database.prepare('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow | undefined;
	return row ?? null;
}

export function setGithubArchived(id: number, archived: boolean): void {
	const database = getDb();
	database.prepare('UPDATE repos SET github_archived = ? WHERE id = ?').run(archived ? 1 : 0, id);
}

export function listEnrichedReposForArchive(limit: number): RepoRow[] {
	const database = getDb();
	return database
		.prepare(
			`SELECT r.* FROM repos r
			 WHERE r.enriched_at IS NOT NULL
			   AND r.default_branch IS NOT NULL
			   AND r.deleted_at IS NULL
			   AND NOT EXISTS (
			     SELECT 1 FROM archive_snapshots a
			     WHERE a.repo_id = r.id AND a.snapshot_type = 'source'
			   )
			 ORDER BY r.first_seen_at DESC
			 LIMIT ?`
		)
		.all(limit) as RepoRow[];
}
