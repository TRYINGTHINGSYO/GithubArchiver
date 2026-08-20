#!/usr/bin/env tsx
/**
 * Production-readiness validation for TurboVec + MiniLM semantic search.
 *
 * Uses a representative local corpus (no production DB mutation).
 * Requires: sentence-transformers MiniLM worker on SEMANTIC_WORKER_URL.
 *
 * Usage:
 *   SEMANTIC_SEARCH_ENABLED=1 \
 *   SEMANTIC_EMBEDDING_PROVIDER=sentence-transformers \
 *   SEMANTIC_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2 \
 *   DATABASE_PATH=./data/semantic-prod-readiness.db \
 *   SEMANTIC_INDEX_PATH=./data/semantic/prod-readiness.tvim \
 *   npx tsx scripts/semantic-prod-readiness.ts
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './load-env.js';
import { closeDb, getDb } from '../src/lib/server/db/connection.js';
import { insertRepo, saveEnrichment } from '../src/lib/server/db/repos.js';
import { applyRepoIntelligence } from '../src/lib/server/apply-repo-intelligence.js';
import { ensureClusterRegistry } from '../src/lib/server/db/clusters.js';
import { searchReposFts } from '../src/lib/server/db/fts.js';
import { buildRepoFilters } from '../src/lib/server/db/repo-query.js';
import type { RepoQuery, RepoRow } from '../src/lib/server/db/types.js';
import { buildRepositorySemanticDocument } from '../src/lib/server/semantic/document.js';
import { semanticFingerprint } from '../src/lib/server/semantic/fingerprint.js';
import { repositoryVectorId } from '../src/lib/server/semantic/ids.js';
import {
	countSemanticByStatus,
	countSemanticIndexedCurrent,
	markSemanticIndexed,
	upsertSemanticPending
} from '../src/lib/server/semantic/index-state.js';
import { rankHybridCandidates, bm25ToSimilarity } from '../src/lib/server/semantic/ranking.js';
import { searchReposSemanticAware } from '../src/lib/server/semantic/search.js';
import { getSemanticConfig } from '../src/lib/server/semantic/config.js';
import {
	semanticWorkerContains,
	semanticWorkerHealth,
	semanticWorkerIndexBatch,
	semanticWorkerRemove,
	semanticWorkerSearch,
	semanticWorkerStats,
	semanticWorkerSync
} from '../src/lib/server/semantic/client.js';
import { runSemanticIndexCycle } from '../src/lib/server/workers/semantic-index.js';
import {
	EVAL_QUERIES,
	GOLD_REPOS,
	NOISE_TEMPLATE_COUNT,
	buildNoiseRepos,
	type GoldRepo
} from './semantic-prod-readiness-corpus.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const OUT_DIR = path.join(ROOT, 'docs', 'semantic-prod-readiness');
const CORPUS_SIZE = Number(process.env.SEMANTIC_PROD_CORPUS_SIZE ?? 10_000);
const WORKER_PORT = Number(process.env.SEMANTIC_WORKER_PORT ?? 8792);
const WEIGHTS = [
	{ semantic: 0.7, lexical: 0.25, quality: 0.05 },
	{ semantic: 0.6, lexical: 0.3, quality: 0.1 },
	{ semantic: 0.55, lexical: 0.35, quality: 0.1 },
	{ semantic: 0.45, lexical: 0.45, quality: 0.1 }
];

type HitRow = { full_name: string; id: number; score: number | null };

const WARM_LATENCY_ITERS = 40;

function mean(xs: number[]) {
	return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function percentile(xs: number[], p: number) {
	if (!xs.length) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
	return s[idx]!;
}

function rssMbForPid(pid: number): number | null {
	try {
		const status = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], {
			encoding: 'utf8'
		});
		const kb = Number(status.stdout.trim());
		return Number.isFinite(kb) ? Math.round(kb / 1024) : null;
	} catch {
		return null;
	}
}

/** Sum RSS for pid + recursive children (torch may spawn helpers). */
function processTreeRssMb(rootPid: number): number | null {
	try {
		const out = spawnSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' });
		if (out.status !== 0) return rssMbForPid(rootPid);
		const rows = out.stdout
			.trim()
			.split('\n')
			.map((line) => line.trim().split(/\s+/).map(Number))
			.filter((p) => p.length === 3 && p.every((n) => Number.isFinite(n)));
		const children = new Map<number, number[]>();
		const rss = new Map<number, number>();
		for (const [pid, ppid, rssKb] of rows) {
			rss.set(pid!, rssKb!);
			const list = children.get(ppid!) ?? [];
			list.push(pid!);
			children.set(ppid!, list);
		}
		let totalKb = 0;
		const stack = [rootPid];
		const seen = new Set<number>();
		while (stack.length) {
			const pid = stack.pop()!;
			if (seen.has(pid)) continue;
			seen.add(pid);
			totalKb += rss.get(pid) ?? 0;
			for (const c of children.get(pid) ?? []) stack.push(c);
		}
		return totalKb > 0 ? Math.round(totalKb / 1024) : rssMbForPid(rootPid);
	} catch {
		return rssMbForPid(rootPid);
	}
}

function latencyStats(samples: number[]) {
	return {
		n: samples.length,
		mean_ms: mean(samples),
		p50_ms: percentile(samples, 50),
		p95_ms: percentile(samples, 95),
		min_ms: samples.length ? Math.min(...samples) : 0,
		max_ms: samples.length ? Math.max(...samples) : 0
	};
}

async function measureModeLatency(
	label: 'keyword' | 'semantic' | 'hybrid',
	runOnce: () => Promise<unknown>,
	warmIters = WARM_LATENCY_ITERS
) {
	const coldStart = performance.now();
	await runOnce();
	const coldMs = performance.now() - coldStart;
	const warm: number[] = [];
	for (let i = 0; i < warmIters; i++) {
		const t0 = performance.now();
		await runOnce();
		warm.push(performance.now() - t0);
	}
	return {
		mode: label,
		cold_first_query_ms: coldMs,
		warm: latencyStats(warm)
	};
}

function metricsAtK(ranked: string[], relevant: Set<string>, k: number) {
	const top = ranked.slice(0, k);
	const hits = top.filter((n) => relevant.has(n));
	let mrr = 0;
	for (let i = 0; i < top.length; i++) {
		if (relevant.has(top[i]!)) {
			mrr = 1 / (i + 1);
			break;
		}
	}
	return {
		precision: hits.length / k,
		recall: relevant.size ? hits.length / relevant.size : 0,
		mrr,
		hits: hits.length
	};
}

async function waitForWorker(url: string, timeoutMs = 120_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${url}/health`);
			if (res.ok) {
				const body = (await res.json()) as { ok?: boolean; modelId?: string };
				if (body.ok) return body;
			}
		} catch {
			/* retry */
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`worker not healthy at ${url}`);
}

function startWorker(opts: {
	port: number;
	indexPath: string;
	bits: number;
	logPath: string;
}): ChildProcess {
	const env = {
		...process.env,
		SEMANTIC_EMBEDDING_PROVIDER: 'sentence-transformers',
		SEMANTIC_EMBEDDING_MODEL: 'sentence-transformers/all-MiniLM-L6-v2',
		SEMANTIC_EMBEDDING_DIMS: '384',
		SEMANTIC_VECTOR_BITS: String(opts.bits),
		SEMANTIC_INDEX_SCHEMA_VERSION: '1',
		SEMANTIC_DOCUMENT_VERSION: '1',
		SEMANTIC_INDEX_PATH: opts.indexPath,
		SEMANTIC_WORKER_HOST: '127.0.0.1',
		SEMANTIC_WORKER_PORT: String(opts.port)
	};
	const child = spawn(
		'python3',
		[
			'services/semantic-worker/server.py',
			'--host',
			'127.0.0.1',
			'--port',
			String(opts.port)
		],
		{
			cwd: ROOT,
			env,
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
	const log = createWriteStream(opts.logPath);
	child.stdout?.pipe(log);
	child.stderr?.pipe(log);
	child.on('exit', (code, signal) => {
		log.write(`\n[runner] worker exited code=${code} signal=${signal}\n`);
	});
	return child;
}

function seedRepo(repo: GoldRepo, now: string, idx: number) {
	const inserted = insertRepo({
		owner: repo.owner,
		name: repo.name,
		full_name: `${repo.owner}/${repo.name}`,
		github_url: `https://github.com/${repo.owner}/${repo.name}`,
		event_id: `evt-prod-${repo.owner}-${repo.name}-${idx}`,
		created_at: now,
		first_seen_at: now,
		discovery_source: 'manual'
	});
	if (inserted.status !== 'inserted' || !inserted.id) return null;
	const id = inserted.id;
	saveEnrichment(id, {
		default_branch: 'main',
		description: repo.description,
		language: repo.language,
		stars: repo.stars,
		forks: Math.floor(repo.stars / 20),
		watchers: repo.stars,
		license: 'MIT',
		topics: repo.topics,
		pushed_at: now,
		updated_at: now
	});
	const row = getDb().prepare('SELECT * FROM repos WHERE id = ?').get(id) as never;
	applyRepoIntelligence(row, {
		default_branch: 'main',
		description: repo.description,
		language: repo.language,
		stars: repo.stars,
		forks: Math.floor(repo.stars / 20),
		watchers: repo.stars,
		license: 'MIT',
		topics: repo.topics,
		pushed_at: now,
		updated_at: now
	});
	getDb()
		.prepare(`UPDATE repos SET category = ?, summary = ? WHERE id = ?`)
		.run(repo.category, repo.description, id);

	if (repo.hasReadme || repo.archived) {
		getDb()
			.prepare(
				`INSERT INTO archive_snapshots
				 (repo_id, snapshot_type, file_path, file_size, sha256, head_sha, archived_at)
				 VALUES (?, 'readme', ?, 100, ?, NULL, ?)`
			)
			.run(id, `./data/exports/readme-${id}.md`, `sha-readme-${id}`, now);
	}
	if (repo.hasRelease) {
		getDb()
			.prepare(
				`INSERT INTO releases (repo_id, tag, name, body, draft, prerelease, published_at, first_seen_at)
				 VALUES (?, ?, ?, '', 0, 0, ?, ?)`
			)
			.run(id, `v1.0.${idx}`, `Release ${idx}`, now, now);
	}
	if (repo.cluster) {
		const cluster = getDb()
			.prepare(`SELECT id FROM repo_clusters WHERE slug = ?`)
			.get(repo.cluster) as { id: number } | undefined;
		if (cluster) {
			getDb()
				.prepare(
					`INSERT OR IGNORE INTO repository_cluster_memberships
					 (repository_id, cluster_id, confidence, evidence_json, clustered_at)
					 VALUES (?, ?, 0.9, '{}', ?)`
				)
				.run(id, cluster.id, now);
		}
	}
	return id;
}

async function indexAllViaWorker(
	batchSize: number,
	onBatch?: () => void
) {
	const config = getSemanticConfig();
	const rows = getDb()
		.prepare(
			`SELECT id, description, language, topics, category, summary, owner, name, full_name,
			        interesting_score, stars, signal_tier
			 FROM repos
			 WHERE deleted_at IS NULL AND pending_deletion_at IS NULL AND enriched_at IS NOT NULL
			 ORDER BY id ASC`
		)
		.all() as Array<Record<string, unknown>>;

	let indexBatchWallMs = 0;
	let workerEmbedMs = 0;
	let workerUpsertMs = 0;
	let syncMs = 0;
	let indexed = 0;
	let failed = 0;
	let batchesWithWorkerTimings = 0;

	for (let i = 0; i < rows.length; i += batchSize) {
		const slice = rows.slice(i, i + batchSize);
		const items = slice.map((r) => {
			const id = Number(r.id);
			const document = buildRepositorySemanticDocument(r as never);
			const fingerprint = semanticFingerprint({
				entityKey: String(id),
				document,
				embeddingModel: config.embeddingModel,
				documentVersion: config.documentVersion
			});
			upsertSemanticPending({
				entityType: 'repository',
				entityKey: String(id),
				vectorId: repositoryVectorId(id),
				fingerprint
			});
			return {
				vectorId: repositoryVectorId(id),
				entityType: 'repository' as const,
				entityKey: String(id),
				text: document,
				fingerprint
			};
		});

		const t0 = performance.now();
		const result = await semanticWorkerIndexBatch(items);
		indexBatchWallMs += performance.now() - t0;
		if (result.timings) {
			workerEmbedMs += result.timings.embedMs;
			workerUpsertMs += result.timings.upsertMs;
			batchesWithWorkerTimings += 1;
		}
		onBatch?.();

		const failedIds = new Set(result.failed.map((f) => f.vectorId));
		const ok = items.filter((it) => !failedIds.has(it.vectorId));
		failed += result.failed.length;

		const s0 = performance.now();
		await semanticWorkerSync();
		syncMs += performance.now() - s0;

		for (const item of ok) {
			markSemanticIndexed({
				entityType: item.entityType,
				entityKey: item.entityKey,
				fingerprint: item.fingerprint,
				embeddingModel: config.embeddingModel,
				documentVersion: config.documentVersion,
				dimensions: config.dimensions,
				vectorBits: config.vectorBits
			});
			indexed += 1;
		}
	}

	return {
		indexed,
		failed,
		indexBatchWallMs,
		workerEmbedMs,
		workerUpsertMs,
		batchesWithWorkerTimings,
		syncMs,
		eligible: rows.length
	};
}

async function searchModes(query: string, limit = 10) {
	const keyword = searchReposFts({ q: query, page: 1, perPage: limit });
	const keywordHits: HitRow[] = keyword.repos.map((r) => ({
		full_name: r.full_name,
		id: r.id,
		score: (r as { fts_rank?: number | null }).fts_rank ?? null
	}));

	const semantic = await searchReposSemanticAware({
		q: query,
		searchMode: 'semantic',
		page: 1,
		perPage: limit
	});
	const semanticHits: HitRow[] = semantic.repos.map((r) => ({
		full_name: r.full_name,
		id: r.id,
		score: r.semantic_score
	}));

	const hybrid = await searchReposSemanticAware({
		q: query,
		searchMode: 'hybrid',
		page: 1,
		perPage: limit
	});
	const hybridHits: HitRow[] = hybrid.repos.map((r) => ({
		full_name: r.full_name,
		id: r.id,
		score: r.final_score
	}));

	return { keywordHits, semanticHits, hybridHits, semanticAvailable: semantic.semanticAvailable };
}

function countEligibleForOpts(opts: RepoQuery): number {
	const { clause, params } = buildRepoFilters({ ...opts, q: undefined });
	const filterSql = clause ? clause : 'WHERE 1=1';
	const row = getDb()
		.prepare(`SELECT COUNT(*) AS c FROM repos ${filterSql}`)
		.get(...params) as { c: number };
	return row.c;
}

function repoInCluster(repoId: number, slug: string): boolean {
	const row = getDb()
		.prepare(
			`SELECT 1 AS ok
			 FROM repository_cluster_memberships m
			 JOIN repo_clusters c ON c.id = m.cluster_id
			 WHERE m.repository_id = ? AND c.slug = ?
			 LIMIT 1`
		)
		.get(repoId, slug) as { ok: number } | undefined;
	return Boolean(row);
}

function repoHasReadme(repoId: number): boolean {
	const row = getDb()
		.prepare(
			`SELECT 1 AS ok FROM archive_snapshots
			 WHERE repo_id = ? AND snapshot_type = 'readme' LIMIT 1`
		)
		.get(repoId) as { ok: number } | undefined;
	return Boolean(row);
}

function repoHasRelease(repoId: number): boolean {
	const row = getDb()
		.prepare(`SELECT 1 AS ok FROM releases WHERE repo_id = ? LIMIT 1`)
		.get(repoId) as { ok: number } | undefined;
	return Boolean(row);
}

function repoArchived(repoId: number): boolean {
	const row = getDb()
		.prepare(`SELECT 1 AS ok FROM archive_snapshots WHERE repo_id = ? LIMIT 1`)
		.get(repoId) as { ok: number } | undefined;
	return Boolean(row);
}

function assertFilterCompliance(
	repos: RepoRow[],
	opts: RepoQuery
): string[] {
	const leaks: string[] = [];
	for (const repo of repos) {
		if (opts.language && repo.language !== opts.language) {
			leaks.push(`language:${repo.full_name}`);
		}
		if (opts.minStars != null && (repo.stars ?? 0) < opts.minStars) {
			leaks.push(`minStars:${repo.full_name}`);
		}
		if (opts.maxStars != null && (repo.stars ?? 0) > opts.maxStars) {
			leaks.push(`maxStars:${repo.full_name}`);
		}
		if (opts.category && repo.category !== opts.category) {
			leaks.push(`category:${repo.full_name}`);
		}
		if (opts.cluster && !repoInCluster(repo.id, opts.cluster)) {
			leaks.push(`cluster:${repo.full_name}`);
		}
		if (opts.dateFrom) {
			const from = `${opts.dateFrom}T00:00:00.000Z`;
			if (!repo.first_seen_at || repo.first_seen_at < from) {
				leaks.push(`dateFrom:${repo.full_name}`);
			}
		}
		if (opts.dateTo) {
			const to = `${opts.dateTo}T23:59:59.999Z`;
			if (!repo.first_seen_at || repo.first_seen_at > to) {
				leaks.push(`dateTo:${repo.full_name}`);
			}
		}
		if (opts.hasReadme && !repoHasReadme(repo.id)) {
			leaks.push(`hasReadme:${repo.full_name}`);
		}
		if (opts.hasRelease && !repoHasRelease(repo.id)) {
			leaks.push(`hasRelease:${repo.full_name}`);
		}
		if (opts.archivedOnly && !repoArchived(repo.id)) {
			leaks.push(`archivedOnly:${repo.full_name}`);
		}
		if (repo.deleted_at || repo.pending_deletion_at) {
			leaks.push(`tombstone:${repo.full_name}`);
		}
	}
	return leaks;
}

async function main() {
	mkdirSync(OUT_DIR, { recursive: true });
	mkdirSync(path.join(ROOT, 'data', 'semantic'), { recursive: true });
	mkdirSync(path.join(ROOT, 'data', 'exports'), { recursive: true });

	const dbPath = path.join(ROOT, 'data', 'semantic-prod-readiness.db');
	const indexPath = path.join(ROOT, 'data', 'semantic', 'prod-readiness-2bit.tvim');
	const workerUrl = `http://127.0.0.1:${WORKER_PORT}`;

	// Ignore ambient SEMANTIC_* from prior smoke tests in this shell.
	process.env.DATABASE_PATH = dbPath;
	process.env.SEMANTIC_SEARCH_ENABLED = '1';
	process.env.SEMANTIC_EMBEDDING_PROVIDER = 'sentence-transformers';
	process.env.SEMANTIC_EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
	process.env.SEMANTIC_EMBEDDING_DIMS = '384';
	process.env.SEMANTIC_VECTOR_BITS = '2';
	process.env.SEMANTIC_WORKER_URL = workerUrl;
	process.env.SEMANTIC_INDEX_PATH = indexPath;
	process.env.SEMANTIC_ALLOWLIST_SOFT_MAX = '80';
	process.env.SEMANTIC_WORKER_TIMEOUT_MS = '60000';
	delete process.env.SEMANTIC_WORKER_PORT; // runner controls port via spawn args + WORKER_URL

	if (existsSync(dbPath)) rmSync(dbPath);
	for (const p of [
		indexPath,
		`${indexPath}.meta.json`,
		indexPath.replace('2bit', '3bit'),
		`${indexPath.replace('2bit', '3bit')}.meta.json`,
		indexPath.replace('2bit', '4bit'),
		`${indexPath.replace('2bit', '4bit')}.meta.json`
	]) {
		if (existsSync(p)) rmSync(p);
	}

	console.log('Seeding representative corpus…');
	getDb();
	ensureClusterRegistry();
	// Ensure filter clusters exist even if registry names differ
	const now = '2024-06-15T12:00:00.000Z';
	for (const slug of ['ops', 'developer-tools', 'security']) {
		getDb()
			.prepare(
				`INSERT OR IGNORE INTO repo_clusters
				 (slug, name, description, cluster_type, repo_count, created_at, updated_at)
				 VALUES (?, ?, ?, 'curated', 0, ?, ?)`
			)
			.run(slug, slug, slug, now, now);
	}

	const noiseCount = Math.max(0, CORPUS_SIZE - GOLD_REPOS.length);
	const all = [...GOLD_REPOS, ...buildNoiseRepos(noiseCount)];
	let seeded = 0;
	for (let i = 0; i < all.length; i++) {
		const id = seedRepo(all[i]!, now, i);
		if (id != null) seeded += 1;
	}

	// A few deleted / pending to confirm eligibility filtering
	const doomed = getDb()
		.prepare(
			`SELECT id FROM repos WHERE full_name LIKE 'noise0/%' ORDER BY id LIMIT 5`
		)
		.all() as { id: number }[];
	for (const [i, row] of doomed.entries()) {
		if (i < 3) {
			getDb()
				.prepare(`UPDATE repos SET deleted_at = ? WHERE id = ?`)
				.run('2026-08-01T00:00:00.000Z', row.id);
		} else {
			getDb()
				.prepare(`UPDATE repos SET pending_deletion_at = ? WHERE id = ?`)
				.run('2026-08-01T00:00:00.000Z', row.id);
		}
	}

	const totals = getDb()
		.prepare(
			`SELECT
			   COUNT(*) AS total,
			   SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted,
			   SUM(CASE WHEN pending_deletion_at IS NOT NULL THEN 1 ELSE 0 END) AS pending,
			   SUM(CASE WHEN deleted_at IS NULL AND pending_deletion_at IS NULL AND enriched_at IS NOT NULL THEN 1 ELSE 0 END) AS eligible
			 FROM repos`
		)
		.get() as {
		total: number;
		deleted: number;
		pending: number;
		eligible: number;
	};

	console.log('Starting MiniLM worker…');
	const runtimeDir = path.join('/tmp', `semantic-prod-readiness-${process.pid}`);
	mkdirSync(runtimeDir, { recursive: true });
	const modelLoadStart = Date.now();
	const worker = startWorker({
		port: WORKER_PORT,
		indexPath,
		bits: 2,
		logPath: path.join(runtimeDir, 'worker-2bit.log')
	});
	if (!worker.pid) throw new Error('worker failed to start (no pid)');
	const workerPid = worker.pid;
	const health = await waitForWorker(workerUrl);
	if (String((health as { indexPath?: string }).indexPath ?? '') !== indexPath) {
		throw new Error(
			`worker indexPath mismatch: got=${(health as { indexPath?: string }).indexPath} expected=${indexPath}`
		);
	}
	const modelLoadMs = Date.now() - modelLoadStart;
	const workerRssAfterModelLoad = processTreeRssMb(workerPid);
	console.log('Worker ready', health, `rss_mb=${workerRssAfterModelLoad}`);

	console.log('Indexing corpus…');
	const wall0 = Date.now();
	const nodeRssBefore = rssMbForPid(process.pid) ?? 0;
	let nodePeakRss = nodeRssBefore;
	let workerPeakRss = workerRssAfterModelLoad ?? 0;
	const indexStats = await indexAllViaWorker(64, () => {
		const nodeSample = rssMbForPid(process.pid);
		if (nodeSample != null) nodePeakRss = Math.max(nodePeakRss, nodeSample);
		const sample = processTreeRssMb(workerPid);
		if (sample != null) workerPeakRss = Math.max(workerPeakRss, sample);
	});
	const wallMs = Date.now() - wall0;
	const nodeRssAfter = rssMbForPid(process.pid);
	if (nodeRssAfter != null) nodePeakRss = Math.max(nodePeakRss, nodeRssAfter);
	const workerRssAfterIndex = processTreeRssMb(workerPid);
	if (workerRssAfterIndex != null) {
		workerPeakRss = Math.max(workerPeakRss, workerRssAfterIndex);
	}
	const stats = await semanticWorkerStats();

	const indexReport = {
		corpus: {
			requested: CORPUS_SIZE,
			seeded,
			total: totals.total,
			eligible: totals.eligible,
			deleted: totals.deleted,
			pending_deletion: totals.pending,
			gold: GOLD_REPOS.length,
			noise: noiseCount,
			noise_template_count: NOISE_TEMPLATE_COUNT
		},
		indexing: {
			indexed: indexStats.indexed,
			failed: indexStats.failed,
			sqlite_indexed_current: countSemanticIndexedCurrent(),
			status_counts: countSemanticByStatus(),
			wall_clock_s: wallMs / 1000,
			repos_per_sec: indexStats.indexed / (wallMs / 1000),
			index_batch_wall_s: indexStats.indexBatchWallMs / 1000,
			worker_embed_s: indexStats.workerEmbedMs / 1000,
			worker_upsert_s: indexStats.workerUpsertMs / 1000,
			batches_with_worker_timings: indexStats.batchesWithWorkerTimings,
			sync_wall_s: indexStats.syncMs / 1000,
			timing_note:
				'index_batch_wall_s is end-to-end HTTP indexBatch (serialize+embed+upsert+response). worker_embed_s / worker_upsert_s come from Python worker instrumentation. sync_wall_s is durable sync() only. No synthetic upsert fraction is invented.',
			index_bytes: stats?.indexBytes ?? null,
			model_load_s: modelLoadMs / 1000
		},
		memory: {
			node_rss_before_mb: nodeRssBefore,
			node_rss_peak_mb: nodePeakRss,
			node_rss_after_index_mb: nodeRssAfter,
			python_worker_pid: workerPid,
			python_worker_rss_after_model_load_mb: workerRssAfterModelLoad,
			python_worker_peak_rss_during_index_mb: workerPeakRss,
			python_worker_rss_after_index_mb: workerRssAfterIndex,
			note: 'Python worker RSS includes recursive child processes when visible via ps. Railway sizing uses python_worker_peak_rss_mb, not Node harness RSS.'
		},
		worker_model: health
	};

	console.log('Running 25-query eval…');
	const perQuery: unknown[] = [];
	const kwR: number[] = [];
	const semR: number[] = [];
	const hybR: number[] = [];
	const kwP: number[] = [];
	const semP: number[] = [];
	const hybP: number[] = [];
	const kwM: number[] = [];
	const semM: number[] = [];
	const hybM: number[] = [];
	let semWins = 0;
	let kwWins = 0;
	let ties = 0;
	const regressions: unknown[] = [];

	for (const q of EVAL_QUERIES) {
		const modes = await searchModes(q.query, 10);
		const relevant = new Set(q.relevant);
		const kwNames = modes.keywordHits.map((h) => h.full_name);
		const semNames = modes.semanticHits.map((h) => h.full_name);
		const hybNames = modes.hybridHits.map((h) => h.full_name);
		const km = metricsAtK(kwNames, relevant, 10);
		const sm = metricsAtK(semNames, relevant, 10);
		const hm = metricsAtK(hybNames, relevant, 10);
		kwR.push(km.recall);
		semR.push(sm.recall);
		hybR.push(hm.recall);
		kwP.push(km.precision);
		semP.push(sm.precision);
		hybP.push(hm.precision);
		kwM.push(km.mrr);
		semM.push(sm.mrr);
		hybM.push(hm.mrr);
		if (sm.mrr > km.mrr + 1e-9) semWins += 1;
		else if (km.mrr > sm.mrr + 1e-9) {
			kwWins += 1;
			regressions.push({
				id: q.id,
				query: q.query,
				keyword_mrr: km.mrr,
				semantic_mrr: sm.mrr,
				keyword_top: kwNames.slice(0, 5),
				semantic_top: semNames.slice(0, 5)
			});
		} else ties += 1;

		perQuery.push({
			id: q.id,
			query: q.query,
			notes: q.notes ?? null,
			relevant: q.relevant,
			keyword: { ...km, top10: modes.keywordHits },
			semantic: { ...sm, top10: modes.semanticHits },
			hybrid: { ...hm, top10: modes.hybridHits }
		});
	}

	console.log('Independent mode latency (cold + warm)…');
	const latencyProbe = 'local voice assistant that works offline';
	const keywordLatency = await measureModeLatency('keyword', async () => {
		searchReposFts({ q: latencyProbe, page: 1, perPage: 10 });
	});
	const semanticLatency = await measureModeLatency('semantic', async () => {
		await searchReposSemanticAware({
			q: latencyProbe,
			searchMode: 'semantic',
			page: 1,
			perPage: 10
		});
	});
	const hybridLatency = await measureModeLatency('hybrid', async () => {
		await searchReposSemanticAware({
			q: latencyProbe,
			searchMode: 'hybrid',
			page: 1,
			perPage: 10
		});
	});
	const workerRssDuringQueries = processTreeRssMb(workerPid);
	if (workerRssDuringQueries != null) {
		workerPeakRss = Math.max(workerPeakRss, workerRssDuringQueries);
	}
	(indexReport.memory as Record<string, unknown>).python_worker_rss_during_query_load_mb =
		workerRssDuringQueries;
	(indexReport.memory as Record<string, unknown>).python_worker_peak_rss_mb = workerPeakRss;

	const modeLatency = {
		note: 'Each mode measured independently. Warm stats exclude the cold first query. Combined 3-mode durations are never labeled as hybrid latency.',
		warm_iterations: WARM_LATENCY_ITERS,
		keyword: keywordLatency,
		semantic: semanticLatency,
		hybrid: hybridLatency
	};

	console.log('Weight sweep…');
	const rows = getDb()
		.prepare(
			`SELECT id, full_name, interesting_score, stars FROM repos
			 WHERE deleted_at IS NULL AND pending_deletion_at IS NULL`
		)
		.all() as Array<{
		id: number;
		full_name: string;
		interesting_score: number | null;
		stars: number | null;
	}>;
	const byId = new Map(rows.map((r) => [r.id, r]));
	const weightResults: unknown[] = [];
	for (const w of WEIGHTS) {
		const recalls: number[] = [];
		const mrrs: number[] = [];
		for (const q of EVAL_QUERIES) {
			const fts = searchReposFts({ q: q.query, page: 1, perPage: 50 });
			const semHits = await semanticWorkerSearch({ query: q.query, k: 50 });
			const candidates = new Map<
				number,
				{
					id: number;
					semanticScore: number | null;
					lexicalScore: number | null;
					interestingScore: number | null;
					stars: number | null;
				}
			>();
			for (const h of semHits) {
				const row = byId.get(h.vectorId);
				if (!row) continue;
				candidates.set(h.vectorId, {
					id: h.vectorId,
					semanticScore: h.score,
					lexicalScore: null,
					interestingScore: row.interesting_score,
					stars: row.stars
				});
			}
			for (const r of fts.repos) {
				const cur = candidates.get(r.id) ?? {
					id: r.id,
					semanticScore: null,
					lexicalScore: null,
					interestingScore: byId.get(r.id)?.interesting_score ?? null,
					stars: byId.get(r.id)?.stars ?? null
				};
				cur.lexicalScore = bm25ToSimilarity(r.fts_rank);
				candidates.set(r.id, cur);
			}
			const ranked = rankHybridCandidates([...candidates.values()], {
				semanticWeight: w.semantic,
				lexicalWeight: w.lexical,
				qualityWeight: w.quality
			});
			const names = ranked
				.map((x) => byId.get(x.id)?.full_name)
				.filter((x): x is string => Boolean(x));
			const m = metricsAtK(names, new Set(q.relevant), 10);
			recalls.push(m.recall);
			mrrs.push(m.mrr);
		}
		weightResults.push({
			weights: w,
			macro_recall_at_10: mean(recalls),
			macro_mrr: mean(mrrs)
		});
	}

	console.log('Filter validation…');
	const filterCases: Array<{
		name: string;
		query: string;
		opts: RepoQuery;
		softMax?: number;
		expectMin?: number;
		expectSoftMaxExceeded?: boolean;
	}> = [
		{
			name: 'language=Python',
			query: 'offline speech recognition wake word',
			opts: { language: 'Python' },
			expectMin: 1
		},
		{
			name: 'minStars=500',
			query: 'download manager torrent',
			opts: { minStars: 500 },
			expectMin: 1
		},
		{
			name: 'maxStars=50',
			query: 'utility formatting JSON logs',
			opts: { maxStars: 50 },
			expectMin: 1
		},
		{
			name: 'category=networking',
			query: 'network monitoring dashboard',
			opts: { category: 'networking' },
			expectMin: 1
		},
		{
			name: 'cluster=ops',
			query: 'infrastructure monitoring',
			opts: { cluster: 'ops' },
			expectMin: 1
		},
		{
			name: 'date range 2024',
			query: 'local voice assistant',
			opts: { dateFrom: '2024-01-01', dateTo: '2024-12-31' },
			expectMin: 1
		},
		{
			name: 'hasReadme',
			query: 'GitHub backup archive',
			opts: { hasReadme: true },
			expectMin: 1
		},
		{
			name: 'hasRelease',
			query: 'GitHub backup archive',
			opts: { hasRelease: true },
			expectMin: 1
		},
		{
			name: 'archivedOnly',
			query: 'GitHub backup archive',
			opts: { archivedOnly: true },
			expectMin: 1
		},
		{
			name: 'language=Python soft-max exceeded',
			query: 'offline speech recognition wake word',
			opts: { language: 'Python' },
			softMax: 50,
			expectMin: 1,
			expectSoftMaxExceeded: true
		},
		{
			name: 'no hard filters still hides tombstones',
			query: 'utility formatting JSON logs',
			opts: {},
			expectMin: 1
		}
	];
	const filterResults: unknown[] = [];
	const prevSoft = process.env.SEMANTIC_ALLOWLIST_SOFT_MAX;
	let filterFailed = false;
	for (const fc of filterCases) {
		const softMax = fc.softMax ?? 80;
		process.env.SEMANTIC_ALLOWLIST_SOFT_MAX = String(softMax);
		const eligibleCount = countEligibleForOpts(fc.opts);
		const result = await searchReposSemanticAware({
			q: fc.query,
			searchMode: 'hybrid',
			page: 1,
			perPage: 20,
			...fc.opts
		});

		const leaks = assertFilterCompliance(result.repos, fc.opts);
		if (fc.expectMin != null && result.repos.length < fc.expectMin) {
			leaks.push(`expectedMinResults:${fc.expectMin}:got:${result.repos.length}`);
		}
		let postFilterPath: boolean | null = null;
		if (fc.expectSoftMaxExceeded) {
			if (eligibleCount <= softMax) {
				leaks.push(
					`softMaxNotExceeded:eligible=${eligibleCount}:softMax=${softMax}`
				);
			} else if (result.retrievalPath !== 'post-filter') {
				leaks.push(`expectedPostFilterPath:got:${result.retrievalPath}`);
			} else {
				postFilterPath = true;
			}
		}
		if (leaks.length) filterFailed = true;
		filterResults.push({
			name: fc.name,
			query: fc.query,
			opts: fc.opts,
			softMax,
			eligibleCount,
			retrievalPath: result.retrievalPath ?? null,
			postFilterPathExercised: postFilterPath,
			returned: result.repos.length,
			semanticAvailable: result.semanticAvailable,
			leaks
		});
	}
	if (prevSoft === undefined) delete process.env.SEMANTIC_ALLOWLIST_SOFT_MAX;
	else process.env.SEMANTIC_ALLOWLIST_SOFT_MAX = prevSoft;
	if (filterFailed) {
		throw new Error(
			`Filter validation failed with leaks: ${JSON.stringify(filterResults)}`
		);
	}

	console.log('Restart / removal persistence…');
	const beforeRestart = await semanticWorkerStats();
	const probeQuery = await semanticWorkerSearch({
		query: 'Discord voice bot',
		k: 5
	});
	worker.kill('SIGTERM');
	await new Promise((r) => setTimeout(r, 1000));
	const worker2 = startWorker({
		port: WORKER_PORT,
		indexPath,
		bits: 2,
		logPath: path.join(runtimeDir, 'worker-2bit-restart.log')
	});
	await waitForWorker(workerUrl);
	const afterRestart = await semanticWorkerStats();
	const probeQuery2 = await semanticWorkerSearch({
		query: 'Discord voice bot',
		k: 5
	});
	const removeIds = probeQuery2.slice(0, 3).map((h) => h.vectorId);
	await semanticWorkerRemove(removeIds);
	await semanticWorkerSync();
	worker2.kill('SIGTERM');
	await new Promise((r) => setTimeout(r, 1000));
	const worker3 = startWorker({
		port: WORKER_PORT,
		indexPath,
		bits: 2,
		logPath: path.join(runtimeDir, 'worker-2bit-after-remove.log')
	});
	await waitForWorker(workerUrl);
	const contains = await semanticWorkerContains(removeIds);
	const restartReport = {
		indexed_before: beforeRestart?.indexedCount ?? null,
		indexed_after_restart: afterRestart?.indexedCount ?? null,
		top_ids_before: probeQuery.map((h) => h.vectorId),
		top_ids_after: probeQuery2.map((h) => h.vectorId),
		removed_ids: removeIds,
		removed_still_absent: contains.missing.length === removeIds.length,
		contains
	};

	console.log('Bit-width comparison (Python exact + TurboVec)…');
	const docs = getDb()
		.prepare(
			`SELECT id, full_name, description, language, topics, category, summary
			 FROM repos
			 WHERE deleted_at IS NULL AND pending_deletion_at IS NULL
			 ORDER BY id ASC
			 LIMIT 3000`
		)
		.all() as Array<Record<string, unknown>>;
	const bitsOutDir = path.join(runtimeDir, 'bits');
	mkdirSync(bitsOutDir, { recursive: true });
	const docPayload = {
		model: 'sentence-transformers/all-MiniLM-L6-v2',
		documents: docs.map((r) => ({
			id: Number(r.id),
			full_name: String(r.full_name),
			text: buildRepositorySemanticDocument(r as never)
		})),
		queries: EVAL_QUERIES.map((q) => ({
			id: q.id,
			text: q.query,
			relevant: q.relevant
		})),
		bits: [2, 3, 4],
		out_dir: bitsOutDir
	};
	const dumpPath = path.join(runtimeDir, 'bit-eval-input.json');
	writeFileSync(dumpPath, JSON.stringify(docPayload));
	const bitPy = spawnSync(
		'python3',
		[path.join(ROOT, 'services/semantic-worker/prod_readiness_bits.py'), dumpPath],
		{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
	);
	let bitReport: unknown = {
		ok: false,
		stderr: bitPy.stderr,
		stdout_tail: bitPy.stdout?.slice(-2000)
	};
	if (bitPy.status === 0) {
		try {
			bitReport = JSON.parse(bitPy.stdout);
			writeFileSync(
				path.join(OUT_DIR, 'bit-comparison.json'),
				JSON.stringify(bitReport, null, 2)
			);
		} catch {
			bitReport = { ok: false, parse_error: true, stdout: bitPy.stdout.slice(0, 2000) };
		}
	}

	// Stop final worker
	worker3.kill('SIGTERM');

	const quality = {
		macro: {
			keyword: {
				recallAt10: mean(kwR),
				precisionAt10: mean(kwP),
				mrr: mean(kwM)
			},
			semantic: {
				recallAt10: mean(semR),
				precisionAt10: mean(semP),
				mrr: mean(semM)
			},
			hybrid: {
				recallAt10: mean(hybR),
				precisionAt10: mean(hybP),
				mrr: mean(hybM)
			}
		},
		semantic_vs_keyword_wins: semWins,
		keyword_vs_semantic_wins: kwWins,
		ties,
		regressions,
		mode_latency: modeLatency
	};

	const turbovecMicro = JSON.parse(
		existsSync(path.join(ROOT, 'data/semantic/benchmark-results.json'))
			? readFileSync(path.join(ROOT, 'data/semantic/benchmark-results.json'), 'utf8')
			: '[]'
	);

	const recommendation = buildRecommendation({
		quality,
		indexReport,
		weightResults,
		bitReport,
		filterResults,
		restartReport
	});

	const full = {
		generated_at: new Date().toISOString(),
		git_head: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
		disclaimer:
			'No production DB was available in this environment. Corpus is a representative 10k-repo GithubArchiver-shaped sample (curated gold + realistic noise). Quality conclusions use MiniLM, not hashing-v1.',
		indexReport,
		quality,
		perQuery,
		weightResults,
		filterResults,
		restartReport,
		bitReport,
		turbovecMicro,
		recommendation
	};

	writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(full, null, 2));
	writeFileSync(
		path.join(OUT_DIR, 'REPORT.md'),
		renderMarkdown(full as never)
	);
	console.log(`Wrote ${path.join(OUT_DIR, 'REPORT.md')}`);
	console.log(JSON.stringify(recommendation, null, 2));
}

function buildRecommendation(input: {
	quality: {
		macro: {
			keyword: { recallAt10: number; mrr: number };
			semantic: { recallAt10: number; mrr: number };
			hybrid: { recallAt10: number; mrr: number };
		};
		semantic_vs_keyword_wins: number;
		keyword_vs_semantic_wins: number;
		regressions: unknown[];
		mode_latency: {
			hybrid: { warm: { p50_ms: number; p95_ms: number } };
		};
	};
	indexReport: {
		indexing: {
			indexed: number;
			failed: number;
			index_bytes: number | null;
			wall_clock_s: number;
			repos_per_sec: number;
		};
		memory: {
			python_worker_peak_rss_mb?: number;
			python_worker_peak_rss_during_index_mb?: number;
		};
	};
	weightResults: unknown[];
	bitReport: unknown;
	filterResults: unknown[];
	restartReport: {
		removed_still_absent: boolean;
		indexed_before: number | null;
		indexed_after_restart: number | null;
	};
}) {
	const filterLeaks = (input.filterResults as Array<{ leaks: string[] }>).flatMap(
		(f) => f.leaks
	);
	const hybridBetter =
		input.quality.macro.hybrid.mrr >= input.quality.macro.keyword.mrr &&
		input.quality.macro.semantic.mrr > input.quality.macro.keyword.mrr;
	const durable =
		input.restartReport.removed_still_absent &&
		(input.restartReport.indexed_after_restart ?? 0) >=
			(input.restartReport.indexed_before ?? 0) * 0.99;
	const go =
		hybridBetter &&
		durable &&
		filterLeaks.length === 0 &&
		input.indexReport.indexing.failed === 0 &&
		input.quality.macro.semantic.recallAt10 >= 0.5;

	const bestWeight = (
		input.weightResults as Array<{
			weights: { semantic: number; lexical: number; quality: number };
			macro_mrr: number;
		}>
	).sort((a, b) => b.macro_mrr - a.macro_mrr)[0];

	const workerPeak =
		input.indexReport.memory.python_worker_peak_rss_mb ??
		input.indexReport.memory.python_worker_peak_rss_during_index_mb ??
		0;
	// Headroom: ~1.75× measured peak, rounded up to practical Railway sizes.
	const recommendedRamGb =
		workerPeak <= 0
			? null
			: workerPeak < 700
				? 2
				: workerPeak < 1400
					? 4
					: workerPeak < 2800
						? 8
						: Math.ceil((workerPeak * 1.75) / 1024);

	return {
		verdict: go ? 'GO_BEHIND_FEATURE_FLAG' : 'NO_GO_OR_CONDITIONAL',
		go,
		keep_default_weights: true,
		default_weights_note:
			'Do not change defaults from this synthetic run alone. Current 0.55/0.35/0.10 remains recommended unless production-snapshot traffic clearly prefers another mix.',
		observed_best_weights: bestWeight ?? null,
		vector_bits_default: 2,
		vector_bits_note:
			'2-bit remains sensible (smallest index, labeled R@10 near exact). Re-check on a production snapshot before raising bits.',
		railway: {
			worker_private: true,
			expose_publicly: false,
			measured_python_worker_peak_rss_mb: workerPeak || null,
			suggested_ram_gb: recommendedRamGb,
			suggested_resources:
				recommendedRamGb == null
					? 'Measure worker peak RSS before sizing; do not size from Node harness RSS.'
					: `Private MiniLM worker: start with ${recommendedRamGb} GB RAM / 1 vCPU for this measured peak (${workerPeak} MB) with headroom. Scale disk/CPU with archive size. Keep indexBatch/remove/rebuild private.`,
			disk_estimate_2bit_per_100k: '~12–15 MB TurboVec + SQLite state overhead',
			startup: 'MiniLM load typically a few seconds once weights are cached',
			hybrid_warm_p95_ms: input.quality.mode_latency.hybrid.warm.p95_ms
		},
		blockers: [
			...(filterLeaks.length ? [`filter leaks: ${filterLeaks.join(', ')}`] : []),
			...(input.indexReport.indexing.failed
				? [`indexing failures: ${input.indexReport.indexing.failed}`]
				: []),
			...(!durable ? ['restart/removal durability check failed'] : []),
			...(!hybridBetter
				? ['semantic/hybrid did not convincingly beat keyword on this corpus']
				: [])
		],
		limitations: [
			'Corpus is representative with harder near-miss noise — still not a full production dump',
			'Final gate remains a READ-ONLY production-snapshot run of this harness',
			'Weight recommendation must be revalidated on live archive traffic'
		]
	};
}

function renderMarkdown(full: {
	disclaimer: string;
	indexReport: {
		corpus: Record<string, number>;
		indexing: Record<string, unknown>;
		memory: Record<string, unknown>;
		worker_model: unknown;
	};
	quality: {
		macro: Record<string, { recallAt10: number; precisionAt10: number; mrr: number }>;
		semantic_vs_keyword_wins: number;
		keyword_vs_semantic_wins: number;
		ties: number;
		regressions: unknown[];
		mode_latency: unknown;
	};
	perQuery: Array<{
		id: string;
		query: string;
		keyword: { recall: number; mrr: number; top10: HitRow[] };
		semantic: { recall: number; mrr: number; top10: HitRow[] };
		hybrid: { recall: number; mrr: number; top10: HitRow[] };
	}>;
	weightResults: unknown[];
	filterResults: Array<{ name: string; returned: number; leaks: string[] }>;
	restartReport: Record<string, unknown>;
	bitReport: unknown;
	recommendation: Record<string, unknown>;
	turbovecMicro: unknown;
}): string {
	const lines: string[] = [];
	lines.push('# Semantic search production-readiness report');
	lines.push('');
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push('');
	lines.push(`> ${full.disclaimer}`);
	lines.push('');
	lines.push(`## Verdict: **${String(full.recommendation.verdict)}**`);
	lines.push('');
	lines.push('### Final gate');
	lines.push('');
	lines.push(
		'This synthetic/harder-noise harness does **not** replace a READ-ONLY production-snapshot run. Do not merge solely on these numbers.'
	);
	lines.push('');
	lines.push('## Corpus');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(full.indexReport.corpus, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('## Indexing performance (MiniLM + TurboVec 2-bit)');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(full.indexReport.indexing, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('## Memory (Node harness vs Python worker)');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(full.indexReport.memory, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('## Quality macro (25 queries)');
	lines.push('');
	lines.push('| Mode | Recall@10 | Precision@10 | MRR |');
	lines.push('|------|-----------|--------------|-----|');
	for (const mode of ['keyword', 'semantic', 'hybrid'] as const) {
		const m = full.quality.macro[mode]!;
		lines.push(
			`| ${mode} | ${m.recallAt10.toFixed(3)} | ${m.precisionAt10.toFixed(3)} | ${m.mrr.toFixed(3)} |`
		);
	}
	lines.push('');
	lines.push(
		`Semantic wins vs keyword (MRR): **${full.quality.semantic_vs_keyword_wins}** · Keyword wins: **${full.quality.keyword_vs_semantic_wins}** · Ties: **${full.quality.ties}**`
	);
	lines.push('');
	lines.push('## Independent mode latency (not a combined 3-mode wrap)');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(full.quality.mode_latency, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('### Regressions (keyword MRR > semantic MRR)');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(full.quality.regressions, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('## 25-query top-10 comparison');
	lines.push('');
	for (const q of full.perQuery) {
		lines.push(`### ${q.id}: \`${q.query}\``);
		lines.push('');
		lines.push(`| mode | R@10 | MRR | top results |`);
		lines.push(`|------|------|-----|-------------|`);
		for (const mode of ['keyword', 'semantic', 'hybrid'] as const) {
			const block = q[mode];
			const tops = block.top10
				.map((h) => `${h.full_name} (${h.score?.toFixed?.(3) ?? h.score})`)
				.join(', ');
			lines.push(
				`| ${mode} | ${block.recall.toFixed(2)} | ${block.mrr.toFixed(2)} | ${tops} |`
			);
		}
		lines.push('');
	}
	lines.push('## Hybrid weight comparison');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(full.weightResults, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('## TurboVec 2/3/4-bit vs exact');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(full.bitReport, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('## TurboVec microbench (random vectors)');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(full.turbovecMicro, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('## Restart / removal');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(full.restartReport, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('## Filters (every returned row asserted)');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(full.filterResults, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('## Recommended production configuration');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(full.recommendation, null, 2));
	lines.push('```');
	lines.push('');
	lines.push('PR #33 was **not** merged by this validation run.');
	lines.push('');
	return lines.join('\n');
}

main()
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	})
	.finally(() => {
		try {
			closeDb();
		} catch {
			/* ignore */
		}
	});
