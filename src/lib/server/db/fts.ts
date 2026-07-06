import { readFileSync } from 'node:fs';
import { getLatestReadmePath } from './archive.js';
import { getDb } from './connection.js';
import type { RepoQuery, RepoQueryResult, RepoRow } from './types.js';

const README_FTS_MAX_CHARS = 50_000;

export interface RepoFtsRow extends RepoRow {
	fts_rank: number | null;
	fts_snippet: string | null;
}

function topicsText(topics: string | null): string {
	if (!topics) return '';
	try {
		return (JSON.parse(topics) as string[]).join(' ');
	} catch {
		return '';
	}
}

export function prepareFtsQuery(raw: string): string | null {
	const terms = raw
		.trim()
		.split(/\s+/)
		.map((t) => t.replace(/["*()]/g, '').trim())
		.filter((t) => t.length > 0);

	if (terms.length === 0) return null;

	return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' ');
}

function truncateReadme(text: string): string {
	if (text.length <= README_FTS_MAX_CHARS) return text;
	return text.slice(0, README_FTS_MAX_CHARS);
}

export function readLatestReadmeText(repoId: number): string | null {
	const path = getLatestReadmePath(repoId);
	if (!path) return null;
	try {
		return truncateReadme(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

export function indexRepoFts(repo: RepoRow, readmeText?: string | null): void {
	const db = getDb();
	const readme = readmeText === undefined ? readLatestReadmeText(repo.id) : readmeText;
	const topics = topicsText(repo.topics);

	db.prepare('DELETE FROM repos_fts WHERE repo_id = ?').run(repo.id);
	db.prepare(
		`INSERT INTO repos_fts
		 (full_name, owner, name, description, language, license, topics, readme_text, repo_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		repo.full_name,
		repo.owner,
		repo.name,
		repo.description ?? '',
		repo.language ?? '',
		repo.license ?? '',
		topics,
		readme ? truncateReadme(readme) : '',
		repo.id
	);
}

export function indexRepoFtsById(repoId: number, readmeText?: string | null): void {
	const db = getDb();
	const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(repoId) as RepoRow | undefined;
	if (repo) indexRepoFts(repo, readmeText);
}

import { buildRepoFilters, buildRepoOrderBy } from './repo-query';

export function searchReposFts(opts: RepoQuery): RepoQueryResult {
	const ftsQuery = prepareFtsQuery(opts.q ?? '');
	if (!ftsQuery) {
		return { repos: [], total: 0, page: 1, perPage: opts.perPage ?? 50, totalPages: 1 };
	}

	const db = getDb();
	const page = Math.max(1, opts.page ?? 1);
	const perPage = Math.min(Math.max(1, opts.perPage ?? 50), 100);
	const offset = (page - 1) * perPage;
	const { clause, params } = buildRepoFilters(opts);
	const filterSql = clause ? `AND ${clause.replace(/^WHERE /, '')}` : '';
	const orderBy = buildRepoOrderBy(opts);
	const explicitSort = Boolean(opts.sort) || Boolean(opts.feed && opts.feed !== 'newest');
	const orderClause = explicitSort ? orderBy : `fts_rank ASC, ${orderBy}`;

	const countRow = db
		.prepare(
			`SELECT COUNT(*) as c
			 FROM repos_fts
			 JOIN repos ON repos.id = repos_fts.repo_id
			 WHERE repos_fts MATCH ? ${filterSql}`
		)
		.get(ftsQuery, ...params) as { c: number };

	const total = countRow.c;

	const repos = db
		.prepare(
			`SELECT repos.*,
			        bm25(repos_fts) AS fts_rank,
			        coalesce(
			          nullif(snippet(repos_fts, 3, '<mark>', '</mark>', '…', 48), ''),
			          nullif(snippet(repos_fts, 7, '<mark>', '</mark>', '…', 48), ''),
			          snippet(repos_fts, 0, '<mark>', '</mark>', '…', 32)
			        ) AS fts_snippet
			 FROM repos_fts
			 JOIN repos ON repos.id = repos_fts.repo_id
			 WHERE repos_fts MATCH ? ${filterSql}
			 ORDER BY ${orderClause}
			 LIMIT ? OFFSET ?`
		)
		.all(ftsQuery, ...params, perPage, offset) as RepoFtsRow[];

	return {
		repos,
		total,
		page,
		perPage,
		totalPages: Math.max(1, Math.ceil(total / perPage))
	};
}

export function countFtsIndexed(): number {
	const db = getDb();
	return (db.prepare('SELECT COUNT(*) as c FROM repos_fts').get() as { c: number }).c;
}

export function rebuildAllFts(database = getDb()): number {
	const repos = database.prepare('SELECT * FROM repos').all() as RepoRow[];
	for (const repo of repos) {
		indexRepoFts(repo);
	}
	return repos.length;
}
