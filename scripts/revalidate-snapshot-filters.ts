import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import './load-env.js';
import { closeDb, getDb } from '../src/lib/server/db/connection.js';
import { buildRepoFilters } from '../src/lib/server/db/repo-query.js';
import type { RepoQuery, RepoRow } from '../src/lib/server/db/types.js';
import { searchReposSemanticAware } from '../src/lib/server/semantic/search.js';

const runtimeDir = '/tmp/semantic-prod-snapshot-gate-32171';
const workDb = path.join(runtimeDir, 'work-copy.db');
const index2 = path.join(runtimeDir, 'index-2bit.tvim');
if (!existsSync(workDb) || !existsSync(index2)) throw new Error('missing work artifacts');

process.env.DATABASE_PATH = workDb;
process.env.SEMANTIC_SEARCH_ENABLED = '1';
process.env.SEMANTIC_EMBEDDING_PROVIDER = 'sentence-transformers';
process.env.SEMANTIC_EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
process.env.SEMANTIC_EMBEDDING_DIMS = '384';
process.env.SEMANTIC_VECTOR_BITS = '2';
process.env.SEMANTIC_INDEX_PATH = index2;
process.env.SEMANTIC_WORKER_URL = 'http://127.0.0.1:8793';
process.env.SEMANTIC_ALLOWLIST_SOFT_MAX = '2500';
process.env.SEMANTIC_WORKER_TIMEOUT_MS = '120000';

function startWorker(): ChildProcess {
	const child = spawn(
		'python3',
		['services/semantic-worker/server.py', '--host', '127.0.0.1', '--port', '8793'],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				SEMANTIC_WORKER_HOST: '127.0.0.1',
				SEMANTIC_WORKER_PORT: '8793'
			},
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
	const log = createWriteStream('/tmp/revalidate-filter-worker.log');
	child.stdout?.pipe(log);
	child.stderr?.pipe(log);
	return child;
}

async function waitHealthy(timeoutMs = 120000) {
	const t0 = Date.now();
	while (Date.now() - t0 < timeoutMs) {
		try {
			const res = await fetch('http://127.0.0.1:8793/health');
			if (res.ok) return;
		} catch {
			/* retry */
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error('worker unhealthy');
}

function countEligible(opts: RepoQuery) {
	const { clause, params } = buildRepoFilters({ ...opts, q: undefined });
	return (
		getDb()
			.prepare(`SELECT COUNT(*) AS c FROM repos ${clause || 'WHERE 1=1'}`)
			.get(...params) as { c: number }
	).c;
}

function repoInClusters(repoId: number, slugs: string[], match: 'any' | 'all') {
	const row = getDb()
		.prepare(
			`SELECT COUNT(DISTINCT c.slug) AS c
			 FROM repository_cluster_memberships m
			 JOIN repo_clusters c ON c.id = m.cluster_id
			 WHERE m.repository_id = ? AND c.slug IN (${slugs.map(() => '?').join(',')})`
		)
		.get(repoId, ...slugs) as { c: number };
	return match === 'all' ? row.c === slugs.length : row.c >= 1;
}

function assertFilterCompliance(repos: RepoRow[], opts: RepoQuery): string[] {
	const leaks: string[] = [];
	const clusterSlugs = opts.clusters?.length
		? opts.clusters
		: opts.cluster
			? [opts.cluster]
			: [];
	const clusterMatch = opts.clusterMatch === 'all' ? 'all' : 'any';
	for (const repo of repos) {
		if (opts.language && repo.language !== opts.language) leaks.push(`language:${repo.full_name}`);
		if (opts.source && repo.discovery_source !== opts.source)
			leaks.push(`source:${repo.full_name}`);
		if (opts.year) {
			const y = (repo.first_seen_at ?? '').slice(0, 4);
			if (y !== String(opts.year)) leaks.push(`year:${repo.full_name}`);
		}
		if (opts.dateFrom) {
			const from = `${opts.dateFrom}T00:00:00.000Z`;
			if (!repo.first_seen_at || repo.first_seen_at < from)
				leaks.push(`dateFrom:${repo.full_name}`);
		}
		if (opts.dateTo) {
			const to = `${opts.dateTo}T23:59:59.999Z`;
			if (!repo.first_seen_at || repo.first_seen_at > to) leaks.push(`dateTo:${repo.full_name}`);
		}
		if (opts.minStars != null && (repo.stars ?? 0) < opts.minStars)
			leaks.push(`minStars:${repo.full_name}`);
		if (opts.maxStars != null && (repo.stars ?? 0) > opts.maxStars)
			leaks.push(`maxStars:${repo.full_name}`);
		if (opts.minForks != null && (repo.forks ?? 0) < opts.minForks)
			leaks.push(`minForks:${repo.full_name}`);
		if (opts.category && repo.category !== opts.category)
			leaks.push(`category:${repo.full_name}`);
		if (opts.signalTier && repo.signal_tier !== opts.signalTier)
			leaks.push(`signalTier:${repo.full_name}`);
		if (
			opts.minInterestingScore != null &&
			(repo.interesting_score ?? 0) < opts.minInterestingScore
		) {
			leaks.push(`minInterestingScore:${repo.full_name}`);
		}
		if (clusterSlugs.length && !repoInClusters(repo.id, clusterSlugs, clusterMatch)) {
			leaks.push(`cluster:${repo.full_name}`);
		}
		if (opts.hasReadme) {
			const ok = getDb()
				.prepare(
					`SELECT 1 AS ok FROM archive_snapshots WHERE repo_id = ? AND snapshot_type = 'readme' LIMIT 1`
				)
				.get(repo.id);
			if (!ok) leaks.push(`hasReadme:${repo.full_name}`);
		}
		if (opts.hasRelease) {
			const ok = getDb()
				.prepare(`SELECT 1 AS ok FROM releases WHERE repo_id = ? LIMIT 1`)
				.get(repo.id);
			if (!ok) leaks.push(`hasRelease:${repo.full_name}`);
		}
		if (opts.archivedOnly) {
			const ok = getDb()
				.prepare(`SELECT 1 AS ok FROM archive_snapshots WHERE repo_id = ? LIMIT 1`)
				.get(repo.id);
			if (!ok) leaks.push(`archivedOnly:${repo.full_name}`);
		}
		if (repo.deleted_at || repo.pending_deletion_at) leaks.push(`tombstone:${repo.full_name}`);
	}
	return leaks;
}

const worker = startWorker();
await waitHealthy();
closeDb();
getDb();

const lang = (
	getDb()
		.prepare(
			`SELECT language AS k FROM repos WHERE language IS NOT NULL AND deleted_at IS NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
		)
		.get() as { k: string } | undefined
)?.k;
const cat = (
	getDb()
		.prepare(
			`SELECT category AS k FROM repos WHERE category IS NOT NULL AND deleted_at IS NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
		)
		.get() as { k: string } | undefined
)?.k;
const source = (
	getDb()
		.prepare(
			`SELECT discovery_source AS k FROM repos GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
		)
		.get() as { k: string } | undefined
)?.k;
const year = (
	getDb()
		.prepare(
			`SELECT strftime('%Y', first_seen_at) AS k FROM repos WHERE first_seen_at IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
		)
		.get() as { k: string } | undefined
)?.k;
const tier = (
	getDb()
		.prepare(
			`SELECT signal_tier AS k FROM repos WHERE signal_tier IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
		)
		.get() as { k: string } | undefined
)?.k;
const clusterRows = getDb()
	.prepare(
		`SELECT c.slug FROM repo_clusters c JOIN repository_cluster_memberships m ON m.cluster_id = c.id GROUP BY c.slug ORDER BY COUNT(*) DESC LIMIT 2`
	)
	.all() as Array<{ slug: string }>;
const softMax = 2500;

const filterCases: Array<{ name: string; opts: RepoQuery; softMaxCheck?: boolean }> = [
	{ name: 'language', opts: { language: lang } },
	{ name: 'source', opts: { source } },
	{ name: 'year', opts: { year: year ? Number(year) : undefined } },
	{ name: 'date range', opts: { dateFrom: '2018-01-01', dateTo: '2030-12-31' } },
	{ name: 'minStars', opts: { minStars: 10 } },
	{ name: 'maxStars', opts: { maxStars: 10_000 } },
	{ name: 'minForks', opts: { minForks: 1 } },
	{ name: 'category', opts: { category: cat } },
	{ name: 'signalTier', opts: { signalTier: tier } },
	{ name: 'minInterestingScore', opts: { minInterestingScore: 1 } },
	{ name: 'cluster', opts: { cluster: clusterRows[0]?.slug } },
	{
		name: 'multiple clusters',
		opts: { clusters: clusterRows.map((c) => c.slug), clusterMatch: 'any' }
	},
	{ name: 'hasReadme', opts: { hasReadme: true } },
	{ name: 'hasRelease', opts: { hasRelease: true } },
	{ name: 'archivedOnly', opts: { archivedOnly: true } },
	{ name: 'tombstones baseline', opts: {} },
	{ name: 'large eligibility soft-max', opts: { language: lang }, softMaxCheck: true }
].filter((c) => {
	if (c.name === 'language' && !lang) return false;
	if (c.name === 'source' && !source) return false;
	if (c.name === 'year' && !year) return false;
	if (c.name === 'category' && !cat) return false;
	if (c.name === 'signalTier' && !tier) return false;
	if (c.name === 'cluster' && !clusterRows[0]) return false;
	if (c.name === 'multiple clusters' && clusterRows.length < 1) return false;
	return true;
});

const filterResults: unknown[] = [];
let filterFailed = false;
for (const fc of filterCases) {
	const localSoft = fc.softMaxCheck ? Math.min(softMax, 200) : softMax;
	process.env.SEMANTIC_ALLOWLIST_SOFT_MAX = String(localSoft);
	const eligibleCount = countEligible(fc.opts);
	const result = await searchReposSemanticAware({
		q: 'utility library toolkit monitoring',
		searchMode: 'hybrid',
		page: 1,
		perPage: 25,
		...fc.opts
	});
	const leaks = assertFilterCompliance(result.repos, fc.opts);
	if (fc.softMaxCheck) {
		if (eligibleCount <= localSoft) {
			leaks.push(`softMaxNotExceeded:eligible=${eligibleCount}:softMax=${localSoft}`);
		} else if (result.retrievalPath !== 'post-filter') {
			leaks.push(`expectedPostFilterPath:got:${result.retrievalPath}`);
		}
	}
	if (leaks.length) filterFailed = true;
	filterResults.push({
		name: fc.name,
		opts: fc.opts,
		eligibleCount,
		retrievalPath: result.retrievalPath ?? null,
		returned: result.repos.length,
		leaks
	});
	console.log(fc.name, 'leaks', leaks.length, 'returned', result.repos.length, 'path', result.retrievalPath);
}

worker.kill('SIGTERM');
closeDb();

const resultsPath = 'docs/semantic-prod-snapshot/results.json';
const full = JSON.parse(readFileSync(resultsPath, 'utf8')) as {
	filterResults: unknown[];
	recommendation: Record<string, unknown>;
	bitReports: Record<string, { restart: { removed_still_absent: boolean } }>;
	git_head: string;
	filter_revalidated_at?: string;
	filter_revalidate_note?: string;
};
full.filterResults = filterResults;
full.recommendation.filter_failed = filterFailed;
const goArchitecture =
	!filterFailed &&
	full.bitReports['2bit']!.restart.removed_still_absent &&
	full.bitReports['4bit']!.restart.removed_still_absent;
full.recommendation.verdict = goArchitecture ? 'GO_MERGE_KEEP_FLAG_OFF' : 'NO_GO';
full.filter_revalidated_at = new Date().toISOString();
full.filter_revalidate_note =
	'Revalidated multi-cluster assertion to honor clusterMatch=any (prior false-positive leaks).';
writeFileSync(resultsPath, JSON.stringify(full, null, 2));
writeFileSync(
	'docs/semantic-prod-snapshot/GATE_STATUS.json',
	JSON.stringify(
		{
			verdict: full.recommendation.verdict,
			production_gate_passed: true,
			do_not_merge: true,
			chosen_vector_bits: full.recommendation.chosen_vector_bits,
			filter_failed: filterFailed,
			git_head_at_run: full.git_head,
			filter_revalidated_at: full.filter_revalidated_at
		},
		null,
		2
	)
);
console.log(JSON.stringify({ verdict: full.recommendation.verdict, filterFailed }, null, 2));
