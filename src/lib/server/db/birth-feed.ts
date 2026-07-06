import { getDb } from './connection.js';
import { buildRepoFilters, buildRepoOrderBy } from './repo-query.js';
import { parseTopics } from './repos.js';
import type { RepoQuery, RepoRow } from './types.js';

export interface BirthFeedQuery {
	source?: string;
	language?: string;
	archivedOnly?: boolean;
	hasReadme?: boolean;
	hasRelease?: boolean;
	sort?: string;
	feed?: string;
	year?: number;
	dateFrom?: string;
	dateTo?: string;
	minStars?: number;
	minForks?: number;
	page?: number;
	perPage?: number;
}

export interface BirthFeedRow extends RepoRow {
	is_enriched: number;
	is_archived: number;
	has_readme: number;
	has_release: number;
}

export interface BirthFeedResult {
	repos: BirthFeedRow[];
	total: number;
	page: number;
	perPage: number;
	totalPages: number;
}

function buildBirthFeedWhere(opts: BirthFeedQuery): {
	clause: string;
	params: (string | number)[];
} {
	const repoOpts: RepoQuery = { ...opts };
	const { clause, params } = buildRepoFilters(repoOpts, 'r');
	return { clause, params };
}

const BIRTH_FEED_SELECT = `
	SELECT r.*,
	       (r.enriched_at IS NOT NULL) AS is_enriched,
	       EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id) AS is_archived,
	       EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id AND a.snapshot_type = 'readme') AS has_readme,
	       EXISTS (SELECT 1 FROM releases rl WHERE rl.repo_id = r.id) AS has_release
	FROM repos r
`;

export function queryBirthFeed(opts: BirthFeedQuery): BirthFeedResult {
	const db = getDb();
	const page = Math.max(1, opts.page ?? 1);
	const perPage = Math.min(Math.max(1, opts.perPage ?? 50), 100);
	const offset = (page - 1) * perPage;
	const { clause, params } = buildBirthFeedWhere(opts);
	const orderBy = buildRepoOrderBy({ ...opts, sort: opts.sort ?? 'newest_discovered' }, 'r');

	const total = (
		db.prepare(`SELECT COUNT(*) as c FROM repos r ${clause}`).get(...params) as { c: number }
	).c;

	const repos = db
		.prepare(`${BIRTH_FEED_SELECT} ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
		.all(...params, perPage, offset) as BirthFeedRow[];

	return {
		repos,
		total,
		page,
		perPage,
		totalPages: Math.max(1, Math.ceil(total / perPage))
	};
}

export function countReposFirstSeenSince(sinceIso: string): number {
	const db = getDb();
	return (
		db.prepare('SELECT COUNT(*) as c FROM repos WHERE first_seen_at >= ?').get(sinceIso) as {
			c: number;
		}
	).c;
}

export function countReposByDiscoverySource(source: string): number {
	const db = getDb();
	return (
		db
			.prepare('SELECT COUNT(*) as c FROM repos WHERE discovery_source = ?')
			.get(source) as { c: number }
	).c;
}

export function sumArchiveSnapshotBytes(): number {
	const db = getDb();
	const row = db.prepare('SELECT COALESCE(SUM(file_size), 0) as s FROM archive_snapshots').get() as {
		s: number;
	};
	return row.s;
}

export function countArchiveSnapshotFiles(): number {
	const db = getDb();
	return (db.prepare('SELECT COUNT(*) as c FROM archive_snapshots').get() as { c: number }).c;
}

export { parseTopics };
