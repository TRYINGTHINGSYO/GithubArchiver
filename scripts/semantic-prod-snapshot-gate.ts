#!/usr/bin/env tsx
/**
 * FINAL GATE: READ-ONLY production-snapshot validation for PR #33.
 *
 * ABSOLUTE SAFETY:
 * - Never open the operator-supplied source DB for writes.
 * - Always copy source → temp work DB, then open only the work copy.
 * - Always build NEW temporary TurboVec indexes (never overwrite production .tvim).
 * - Refuse to claim the production gate without SEMANTIC_PROD_SNAPSHOT_SOURCE + ACK.
 *
 * Usage (production gate — requires a real non-production copy):
 *   SEMANTIC_PROD_SNAPSHOT_SOURCE=/path/to/prod-copy.db \
 *   SEMANTIC_PROD_SNAPSHOT_ACK=I_CONFIRM_THIS_IS_A_NON_PRODUCTION_COPY \
 *   npm run semantic:prod-snapshot-gate
 *
 * Safety proof (does NOT claim production gate):
 *   npm run semantic:prod-snapshot-gate -- --safety-proof
 */
import {
	spawn,
	spawnSync,
	type ChildProcess
} from 'node:child_process';
import {
	copyFileSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './load-env.js';
import { closeDb, getDb } from '../src/lib/server/db/connection.js';
import { searchReposFts, readLatestReadmeText } from '../src/lib/server/db/fts.js';
import { buildRepoFilters } from '../src/lib/server/db/repo-query.js';
import type { RepoQuery, RepoRow } from '../src/lib/server/db/types.js';
import { buildRepositorySemanticDocument } from '../src/lib/server/semantic/document.js';
import { semanticFingerprint } from '../src/lib/server/semantic/fingerprint.js';
import { repositoryVectorId } from '../src/lib/server/semantic/ids.js';
import {
	countSemanticIndexedCurrent,
	markSemanticIndexed,
	upsertSemanticPending
} from '../src/lib/server/semantic/index-state.js';
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
import { SNAPSHOT_QUERIES } from './semantic-prod-snapshot-queries.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const OUT_DIR = path.join(ROOT, 'docs', 'semantic-prod-snapshot');
const ACK = 'I_CONFIRM_THIS_IS_A_NON_PRODUCTION_COPY';
const WORKER_PORT = Number(process.env.SEMANTIC_WORKER_PORT ?? 8793);
const WARM_ITERS = Number(process.env.SEMANTIC_SNAPSHOT_WARM_ITERS ?? 60);
const BATCH = Number(process.env.SEMANTIC_SNAPSHOT_BATCH ?? 64);

type FileFingerprint = { path: string; size: number; mtimeMs: number; ino: number };

function mean(xs: number[]) {
	return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function percentile(xs: number[], p: number) {
	if (!xs.length) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
	return s[idx]!;
}

function latencyStats(samples: number[]) {
	return {
		n: samples.length,
		mean_ms: mean(samples),
		p50_ms: percentile(samples, 50),
		p95_ms: percentile(samples, 95),
		p99_ms: percentile(samples, 99),
		min_ms: samples.length ? Math.min(...samples) : 0,
		max_ms: samples.length ? Math.max(...samples) : 0
	};
}

function fingerprintFile(p: string): FileFingerprint {
	const st = statSync(p);
	return { path: p, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
}

function assertSourceUnchanged(before: FileFingerprint, after: FileFingerprint) {
	if (
		before.size !== after.size ||
		before.mtimeMs !== after.mtimeMs ||
		before.ino !== after.ino
	) {
		throw new Error(
			`SAFETY VIOLATION: snapshot source changed during run: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
		);
	}
}

function rssMbForPid(pid: number): number | null {
	try {
		const status = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
		const kb = Number(status.stdout.trim());
		return Number.isFinite(kb) ? Math.round(kb / 1024) : null;
	} catch {
		return null;
	}
}

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

function operatorRequirementsMarkdown(): string {
	return `# Production-snapshot gate — BLOCKED

Generated: ${new Date().toISOString()}

## Verdict: **NO_GO** (gate not executed)

Railway MCP/CLI access to the production volume was unavailable in this environment.
A synthetic corpus **must not** substitute for this gate.

## Absolute safety rule

Never point this harness at the writable production database.
Provide a **copy** (or filesystem snapshot / backup export). The harness will copy again
into a temp work DB and will never write to the source file or any existing production
TurboVec index.

## Artifact needed from the operator

1. A byte-for-byte (or SQLite backup) copy of the production GithubArchiver SQLite file
   (whatever \`DATABASE_PATH\` points at in production — often \`githubarchive.db\` on the Railway volume).
2. Place it where this agent can read it (upload artifact, mount read-only path, or local path).
3. Re-run:

\`\`\`bash
SEMANTIC_PROD_SNAPSHOT_SOURCE=/absolute/path/to/prod-copy.db \\
SEMANTIC_PROD_SNAPSHOT_ACK=I_CONFIRM_THIS_IS_A_NON_PRODUCTION_COPY \\
npm run semantic:prod-snapshot-gate
\`\`\`

## What the harness does once a copy is supplied

- Corpus inventory (read-only on the work copy)
- Separate temporary 2-bit and 4-bit MiniLM TurboVec indexes
- ≥50 discovery queries with human-review pack (keyword / semantic / hybrid × bits)
- Production filter leak checks
- Scale latency (p50/p95/p99)
- Worker process-tree RSS + Railway sizing
- Restart/removal durability on the temporary index only
- Final GO / NO_GO recommendation (**still does not merge**)

## Safety proof

\`npm run semantic:prod-snapshot-gate -- --safety-proof\` proves copy-open-inventory
and source immutability on a disposable fixture. That proof **does not** pass the
production gate.
`;
}

async function waitForWorker(url: string, timeoutMs = 180_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${url}/health`);
			if (res.ok) {
				const body = (await res.json()) as { ok?: boolean };
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
		['services/semantic-worker/server.py', '--host', '127.0.0.1', '--port', String(opts.port)],
		{ cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }
	);
	const log = createWriteStream(opts.logPath);
	child.stdout?.pipe(log);
	child.stderr?.pipe(log);
	return child;
}

function killWorker(child: ChildProcess | null) {
	if (!child?.pid) return;
	try {
		child.kill('SIGTERM');
	} catch {
		/* ignore */
	}
}

function corpusInventory() {
	const db = getDb();
	const totals = db
		.prepare(
			`SELECT
			   COUNT(*) AS total,
			   SUM(CASE WHEN enriched_at IS NOT NULL THEN 1 ELSE 0 END) AS enriched,
			   SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted,
			   SUM(CASE WHEN pending_deletion_at IS NOT NULL THEN 1 ELSE 0 END) AS pending_deletion,
			   SUM(CASE WHEN deleted_at IS NULL AND pending_deletion_at IS NULL AND enriched_at IS NOT NULL THEN 1 ELSE 0 END) AS eligible,
			   SUM(CASE WHEN description IS NOT NULL AND TRIM(description) != '' THEN 1 ELSE 0 END) AS with_description,
			   SUM(CASE WHEN topics IS NOT NULL AND TRIM(topics) NOT IN ('', '[]', 'null') THEN 1 ELSE 0 END) AS with_topics,
			   SUM(CASE WHEN summary IS NOT NULL AND TRIM(summary) != '' THEN 1 ELSE 0 END) AS with_summary
			 FROM repos`
		)
		.get() as Record<string, number>;

	const withReadme = (
		db
			.prepare(
				`SELECT COUNT(DISTINCT a.repo_id) AS c
				 FROM archive_snapshots a
				 WHERE a.snapshot_type = 'readme'`
			)
			.get() as { c: number }
	).c;

	const language = db
		.prepare(
			`SELECT COALESCE(language, '(null)') AS k, COUNT(*) AS c
			 FROM repos
			 WHERE deleted_at IS NULL AND pending_deletion_at IS NULL
			 GROUP BY 1 ORDER BY c DESC LIMIT 40`
		)
		.all() as Array<{ k: string; c: number }>;

	const category = db
		.prepare(
			`SELECT COALESCE(category, '(null)') AS k, COUNT(*) AS c
			 FROM repos
			 WHERE deleted_at IS NULL AND pending_deletion_at IS NULL
			 GROUP BY 1 ORDER BY c DESC LIMIT 40`
		)
		.all() as Array<{ k: string; c: number }>;

	// Weak semantic text: no description, no summary, no topics, no readme snapshot.
	const weak = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos r
				 WHERE r.deleted_at IS NULL AND r.pending_deletion_at IS NULL
				   AND r.enriched_at IS NOT NULL
				   AND (r.description IS NULL OR TRIM(r.description) = '')
				   AND (r.summary IS NULL OR TRIM(r.summary) = '')
				   AND (r.topics IS NULL OR TRIM(r.topics) IN ('', '[]', 'null'))
				   AND NOT EXISTS (
				     SELECT 1 FROM archive_snapshots a
				     WHERE a.repo_id = r.id AND a.snapshot_type = 'readme'
				   )`
			)
			.get() as { c: number }
	).c;

	return {
		...totals,
		with_readme_snapshot: withReadme,
		weak_or_no_useful_semantic_text: weak,
		language_distribution: language,
		category_distribution: category
	};
}

async function indexAllViaWorker(
	bits: number,
	workerPid: number,
	onBatch?: () => void
) {
	const config = getSemanticConfig();
	const rows = getDb()
		.prepare(
			`SELECT id, description, language, topics, category, summary, owner, name, full_name,
			        interesting_score, stars, signal_tier, homepage
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
	let peakWorkerRss = processTreeRssMb(workerPid) ?? 0;
	const afterModelLoadRss = peakWorkerRss;

	for (let i = 0; i < rows.length; i += BATCH) {
		const slice = rows.slice(i, i + BATCH);
		const items = slice.map((r) => {
			const id = Number(r.id);
			const document = buildRepositorySemanticDocument({
				...(r as never),
				readmeText: readLatestReadmeText(id)
			});
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
		}
		const sample = processTreeRssMb(workerPid);
		if (sample != null) peakWorkerRss = Math.max(peakWorkerRss, sample);
		onBatch?.();

		const failedIds = new Set(result.failed.map((f) => f.vectorId));
		failed += result.failed.length;
		const s0 = performance.now();
		await semanticWorkerSync();
		syncMs += performance.now() - s0;

		for (const item of items.filter((it) => !failedIds.has(it.vectorId))) {
			markSemanticIndexed({
				entityType: item.entityType,
				entityKey: item.entityKey,
				fingerprint: item.fingerprint,
				embeddingModel: config.embeddingModel,
				documentVersion: config.documentVersion,
				dimensions: config.dimensions,
				vectorBits: bits
			});
			indexed += 1;
		}
	}

	const afterRss = processTreeRssMb(workerPid);
	if (afterRss != null) peakWorkerRss = Math.max(peakWorkerRss, afterRss);

	return {
		eligible: rows.length,
		indexed,
		failed,
		indexBatchWallMs,
		workerEmbedMs,
		workerUpsertMs,
		syncMs,
		afterModelLoadRss,
		peakWorkerRss,
		afterIndexRss: afterRss,
		sqlite_indexed_current: countSemanticIndexedCurrent()
	};
}

function countEligibleForOpts(opts: RepoQuery): number {
	const { clause, params } = buildRepoFilters({ ...opts, q: undefined });
	const filterSql = clause ? clause : 'WHERE 1=1';
	const row = getDb()
		.prepare(`SELECT COUNT(*) AS c FROM repos ${filterSql}`)
		.get(...params) as { c: number };
	return row.c;
}

function repoInClusters(repoId: number, slugs: string[]): boolean {
	const row = getDb()
		.prepare(
			`SELECT COUNT(DISTINCT c.slug) AS c
			 FROM repository_cluster_memberships m
			 JOIN repo_clusters c ON c.id = m.cluster_id
			 WHERE m.repository_id = ? AND c.slug IN (${slugs.map(() => '?').join(',')})`
		)
		.get(repoId, ...slugs) as { c: number };
	return row.c === slugs.length;
}

function assertFilterCompliance(repos: RepoRow[], opts: RepoQuery): string[] {
	const leaks: string[] = [];
	const clusterSlugs =
		opts.clusters?.length ? opts.clusters : opts.cluster ? [opts.cluster] : [];
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
			if (!repo.first_seen_at || repo.first_seen_at < from) leaks.push(`dateFrom:${repo.full_name}`);
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
		if (clusterSlugs.length && !repoInClusters(repo.id, clusterSlugs)) {
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

type HitDetail = {
	rank: number;
	id: number;
	full_name: string;
	description: string | null;
	language: string | null;
	stars: number | null;
	semantic_score: number | null;
	lexical_score: number | null;
	final_score: number | null;
};

function toHitDetails(
	repos: Array<
		RepoRow & {
			semantic_score?: number | null;
			final_score?: number | null;
			fts_rank?: number | null;
		}
	>
): HitDetail[] {
	return repos.map((r, i) => ({
		rank: i + 1,
		id: r.id,
		full_name: r.full_name,
		description: r.description,
		language: r.language,
		stars: r.stars,
		semantic_score: r.semantic_score ?? null,
		lexical_score: r.fts_rank ?? null,
		final_score: r.final_score ?? null
	}));
}

function overlapAtK(a: string[], b: string[], k: number): number {
	const A = new Set(a.slice(0, k));
	const B = b.slice(0, k);
	if (!B.length) return 0;
	return B.filter((x) => A.has(x)).length / Math.min(k, B.length);
}

function renderHumanReview(perQuery: Array<Record<string, unknown>>): string {
	const lines: string[] = [];
	lines.push('# Human review pack — production snapshot gate');
	lines.push('');
	lines.push('Inspect bad results as carefully as good ones. Scores are raw retrieval scores.');
	lines.push('');
	for (const q of perQuery) {
		lines.push(`## ${q.id}: \`${q.query}\``);
		lines.push('');
		for (const label of [
			'keyword',
			'semantic_2bit',
			'hybrid_2bit',
			'semantic_4bit',
			'hybrid_4bit'
		] as const) {
			const hits = (q[label] as HitDetail[] | undefined) ?? [];
			lines.push(`### ${label}`);
			if (!hits.length) {
				lines.push('_no results_');
				lines.push('');
				continue;
			}
			for (const h of hits) {
				lines.push(
					`${h.rank}. **${h.full_name}** (${h.language ?? '?'}, ★${h.stars ?? 0}) — ${h.description ?? ''}`
				);
				lines.push(
					`   semantic=${h.semantic_score ?? '—'} lexical=${h.lexical_score ?? '—'} final=${h.final_score ?? '—'}`
				);
			}
			lines.push('');
		}
	}
	return lines.join('\n');
}

function writeBlockedArtifacts(extra?: Record<string, unknown>) {
	mkdirSync(OUT_DIR, { recursive: true });
	const body = {
		generated_at: new Date().toISOString(),
		git_head: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
		verdict: 'NO_GO',
		gate_status: 'BLOCKED_NO_PRODUCTION_SNAPSHOT',
		production_gate_passed: false,
		do_not_merge: true,
		reason:
			'No operator-supplied production SQLite copy was available. Railway MCP/CLI unavailable. Synthetic corpus must not substitute.',
		operator_requirements: {
			env: {
				SEMANTIC_PROD_SNAPSHOT_SOURCE: '/absolute/path/to/prod-copy.db',
				SEMANTIC_PROD_SNAPSHOT_ACK: ACK
			},
			command: 'npm run semantic:prod-snapshot-gate',
			artifact:
				'A non-writable copy/backup of the production GithubArchiver SQLite DATABASE_PATH file (not the live volume path).'
		},
		...extra
	};
	writeFileSync(path.join(OUT_DIR, 'GATE_STATUS.json'), JSON.stringify(body, null, 2));
	writeFileSync(path.join(OUT_DIR, 'REPORT.md'), operatorRequirementsMarkdown());
	return body;
}

async function runSafetyProof() {
	const runtimeDir = path.join('/tmp', `semantic-prod-snapshot-safety-${process.pid}`);
	mkdirSync(runtimeDir, { recursive: true });
	const fixtureSource = path.join(runtimeDir, 'fixture-source.db');
	const fixtureWork = path.join(runtimeDir, 'fixture-work.db');
	const seed = path.join(ROOT, 'data', 'semantic-prod-readiness.db');
	if (!existsSync(seed)) {
		throw new Error(`safety-proof needs fixture seed at ${seed} (run synthetic readiness once)`);
	}
	copyFileSync(seed, fixtureSource);
	const before = fingerprintFile(fixtureSource);
	copyFileSync(fixtureSource, fixtureWork);
	process.env.DATABASE_PATH = fixtureWork;
	closeDb();
	getDb();
	const inventory = corpusInventory();
	closeDb();
	const after = fingerprintFile(fixtureSource);
	assertSourceUnchanged(before, after);
	const proof = {
		ok: true,
		mode: 'safety-proof',
		production_gate_passed: false,
		source_fingerprint: before,
		source_unchanged: true,
		work_db: fixtureWork,
		inventory_sample: {
			total: inventory.total,
			eligible: inventory.eligible,
			enriched: inventory.enriched
		},
		note: 'Copy→work-open→inventory succeeded; source file bytes/mtime/ino unchanged. This does NOT pass the production gate.'
	};
	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(path.join(OUT_DIR, 'SAFETY_PROOF.json'), JSON.stringify(proof, null, 2));
	writeBlockedArtifacts({ safety_proof: proof });
	console.log(JSON.stringify(proof, null, 2));
	return proof;
}

async function runFullGate(sourcePath: string) {
	const absSource = path.resolve(sourcePath);
	if (!existsSync(absSource)) throw new Error(`snapshot source not found: ${absSource}`);
	if (process.env.SEMANTIC_PROD_SNAPSHOT_ACK !== ACK) {
		throw new Error(`Set SEMANTIC_PROD_SNAPSHOT_ACK=${ACK}`);
	}

	const runtimeDir = path.join('/tmp', `semantic-prod-snapshot-gate-${process.pid}`);
	mkdirSync(runtimeDir, { recursive: true });
	mkdirSync(OUT_DIR, { recursive: true });

	const workDb = path.join(runtimeDir, 'work-copy.db');
	const index2 = path.join(runtimeDir, 'index-2bit.tvim');
	const index4 = path.join(runtimeDir, 'index-4bit.tvim');
	const before = fingerprintFile(absSource);
	copyFileSync(absSource, workDb);
	console.log(`Copied snapshot → work DB (${workDb}). Source left untouched.`);

	process.env.DATABASE_PATH = workDb;
	process.env.SEMANTIC_SEARCH_ENABLED = '1';
	process.env.SEMANTIC_EMBEDDING_PROVIDER = 'sentence-transformers';
	process.env.SEMANTIC_EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
	process.env.SEMANTIC_EMBEDDING_DIMS = '384';
	process.env.SEMANTIC_WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
	process.env.SEMANTIC_ALLOWLIST_SOFT_MAX = process.env.SEMANTIC_ALLOWLIST_SOFT_MAX || '2500';
	process.env.SEMANTIC_WORKER_TIMEOUT_MS = '120000';
	delete process.env.SEMANTIC_WORKER_PORT;

	closeDb();
	getDb();
	const inventory = corpusInventory();
	console.log('Inventory', {
		total: inventory.total,
		eligible: inventory.eligible,
		enriched: inventory.enriched
	});

	const workerUrl = process.env.SEMANTIC_WORKER_URL!;
	const bitReports: Record<string, unknown> = {};
	const queryByBits: Record<string, Array<Record<string, unknown>>> = {
		'2': [],
		'4': []
	};

	async function runBit(bits: 2 | 4, indexPath: string) {
		process.env.SEMANTIC_VECTOR_BITS = String(bits);
		process.env.SEMANTIC_INDEX_PATH = indexPath;
		for (const p of [indexPath, `${indexPath}.meta.json`]) {
			if (existsSync(p)) rmSync(p);
		}
		const tLoad0 = Date.now();
		const worker = startWorker({
			port: WORKER_PORT,
			indexPath,
			bits,
			logPath: path.join(runtimeDir, `worker-${bits}bit.log`)
		});
		if (!worker.pid) throw new Error('worker failed to start');
		const health = await waitForWorker(workerUrl);
		const modelLoadMs = Date.now() - tLoad0;
		const rssAfterLoad = processTreeRssMb(worker.pid);
		console.log(`Indexing ${bits}-bit…`);
		const wall0 = Date.now();
		const stats = await indexAllViaWorker(bits, worker.pid);
		const wallMs = Date.now() - wall0;
		const tv = await semanticWorkerStats();

		// Restart durability
		await semanticWorkerSync();
		const beforeRestart = await semanticWorkerStats();
		const probe = await semanticWorkerSearch({
			query: 'self hosted monitoring dashboard',
			k: 5
		});
		killWorker(worker);
		await new Promise((r) => setTimeout(r, 800));
		const tRestart0 = Date.now();
		const worker2 = startWorker({
			port: WORKER_PORT,
			indexPath,
			bits,
			logPath: path.join(runtimeDir, `worker-${bits}bit-restart.log`)
		});
		await waitForWorker(workerUrl);
		const restartLoadMs = Date.now() - tRestart0;
		const afterRestart = await semanticWorkerStats();
		const probe2 = await semanticWorkerSearch({
			query: 'self hosted monitoring dashboard',
			k: 5
		});
		const removeIds = probe2.slice(0, 2).map((h) => h.vectorId);
		await semanticWorkerRemove(removeIds);
		await semanticWorkerSync();
		killWorker(worker2);
		await new Promise((r) => setTimeout(r, 800));
		const worker3 = startWorker({
			port: WORKER_PORT,
			indexPath,
			bits,
			logPath: path.join(runtimeDir, `worker-${bits}bit-after-remove.log`)
		});
		await waitForWorker(workerUrl);
		const contains = await semanticWorkerContains(removeIds);

		// Latency + query pack for this bit width
		const latSamples: Record<'keyword' | 'semantic' | 'hybrid', number[]> = {
			keyword: [],
			semantic: [],
			hybrid: []
		};
		const probeQs = SNAPSHOT_QUERIES.slice(0, 12).map((q) => q.query);
		for (const mode of ['keyword', 'semantic', 'hybrid'] as const) {
			for (const q of probeQs) {
				for (let i = 0; i < Math.ceil(WARM_ITERS / probeQs.length); i++) {
					const t0 = performance.now();
					if (mode === 'keyword') searchReposFts({ q, page: 1, perPage: 10 });
					else
						await searchReposSemanticAware({
							q,
							searchMode: mode,
							page: 1,
							perPage: 10
						});
					latSamples[mode].push(performance.now() - t0);
				}
			}
		}
		const queryRss = processTreeRssMb(worker3.pid ?? worker.pid);

		const perQuery: Array<Record<string, unknown>> = [];
		for (const q of SNAPSHOT_QUERIES) {
			const keyword = searchReposFts({ q: q.query, page: 1, perPage: 10 });
			const semantic = await searchReposSemanticAware({
				q: q.query,
				searchMode: 'semantic',
				page: 1,
				perPage: 10
			});
			const hybrid = await searchReposSemanticAware({
				q: q.query,
				searchMode: 'hybrid',
				page: 1,
				perPage: 10
			});
			perQuery.push({
				id: q.id,
				query: q.query,
				category: q.category,
				keyword: toHitDetails(keyword.repos as never),
				semantic: toHitDetails(semantic.repos as never),
				hybrid: toHitDetails(hybrid.repos as never)
			});
		}
		queryByBits[String(bits)] = perQuery;

		killWorker(worker3);

		const report = {
			bits,
			health,
			model_load_s: modelLoadMs / 1000,
			restart_load_s: restartLoadMs / 1000,
			indexing: {
				indexed: stats.indexed,
				failed: stats.failed,
				eligible: stats.eligible,
				wall_clock_s: wallMs / 1000,
				repos_per_sec: stats.indexed / (wallMs / 1000 || 1),
				index_batch_wall_s: stats.indexBatchWallMs / 1000,
				worker_embed_s: stats.workerEmbedMs / 1000,
				worker_upsert_s: stats.workerUpsertMs / 1000,
				sync_wall_s: stats.syncMs / 1000,
				index_bytes: tv?.indexBytes ?? null,
				sqlite_indexed_current: stats.sqlite_indexed_current
			},
			memory: {
				python_worker_rss_after_model_load_mb: rssAfterLoad,
				python_worker_peak_rss_during_index_mb: stats.peakWorkerRss,
				python_worker_rss_after_index_mb: stats.afterIndexRss,
				python_worker_rss_during_query_load_mb: queryRss
			},
			latency: {
				warm_iterations_target: WARM_ITERS,
				keyword: latencyStats(latSamples.keyword),
				semantic: latencyStats(latSamples.semantic),
				hybrid: latencyStats(latSamples.hybrid)
			},
			restart: {
				indexed_before: beforeRestart?.indexedCount ?? null,
				indexed_after: afterRestart?.indexedCount ?? null,
				top_ids_before: probe.map((h) => h.vectorId),
				top_ids_after: probe2.map((h) => h.vectorId),
				ids_stable:
					JSON.stringify(probe.map((h) => h.vectorId)) ===
					JSON.stringify(probe2.map((h) => h.vectorId)),
				removed_ids: removeIds,
				removed_still_absent: contains.missing.length === removeIds.length
			}
		};
		bitReports[`${bits}bit`] = report;
		return report;
	}

	await runBit(2, index2);
	await runBit(4, index4);

	// Merge review pack across bits
	const review: Array<Record<string, unknown>> = [];
	const q2 = queryByBits['2']!;
	const q4 = queryByBits['4']!;
	const byId4 = new Map(q4.map((x) => [x.id as string, x]));
	const overlaps: number[] = [];
	for (const row of q2) {
		const other = byId4.get(row.id as string);
		const sem2 = (row.semantic as HitDetail[]).map((h) => h.full_name);
		const sem4 = ((other?.semantic as HitDetail[]) ?? []).map((h) => h.full_name);
		const ov = overlapAtK(sem2, sem4, 10);
		overlaps.push(ov);
		review.push({
			id: row.id,
			query: row.query,
			category: row.category,
			keyword: row.keyword,
			semantic_2bit: row.semantic,
			hybrid_2bit: row.hybrid,
			semantic_4bit: other?.semantic ?? [],
			hybrid_4bit: other?.hybrid ?? [],
			top10_overlap_semantic_2_vs_4: ov
		});
	}

	// Filter validation (against 2-bit worker still down — restart 2-bit for filters)
	process.env.SEMANTIC_VECTOR_BITS = '2';
	process.env.SEMANTIC_INDEX_PATH = index2;
	const filterWorker = startWorker({
		port: WORKER_PORT,
		indexPath: index2,
		bits: 2,
		logPath: path.join(runtimeDir, 'worker-filter.log')
	});
	await waitForWorker(workerUrl);

	const lang = (
		getDb()
			.prepare(
				`SELECT language AS k FROM repos
				 WHERE language IS NOT NULL AND deleted_at IS NULL
				 GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
			)
			.get() as { k: string } | undefined
	)?.k;
	const cat = (
		getDb()
			.prepare(
				`SELECT category AS k FROM repos
				 WHERE category IS NOT NULL AND deleted_at IS NULL
				 GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
			)
			.get() as { k: string } | undefined
	)?.k;
	const source = (
		getDb()
			.prepare(
				`SELECT discovery_source AS k FROM repos
				 GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
			)
			.get() as { k: string } | undefined
	)?.k;
	const year = (
		getDb()
			.prepare(
				`SELECT strftime('%Y', first_seen_at) AS k FROM repos
				 WHERE first_seen_at IS NOT NULL
				 GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
			)
			.get() as { k: string } | undefined
	)?.k;
	const tier = (
		getDb()
			.prepare(
				`SELECT signal_tier AS k FROM repos
				 WHERE signal_tier IS NOT NULL
				 GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`
			)
			.get() as { k: string } | undefined
	)?.k;
	const clusterRows = getDb()
		.prepare(
			`SELECT c.slug FROM repo_clusters c
			 JOIN repository_cluster_memberships m ON m.cluster_id = c.id
			 GROUP BY c.slug ORDER BY COUNT(*) DESC LIMIT 2`
		)
		.all() as Array<{ slug: string }>;

	const softMax = Number(process.env.SEMANTIC_ALLOWLIST_SOFT_MAX || 2500);
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
		// Drop cases missing required dimension values
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
	const prevSoft = process.env.SEMANTIC_ALLOWLIST_SOFT_MAX;
	for (const fc of filterCases) {
		const localSoft = fc.softMaxCheck ? Math.min(softMax, 200) : softMax;
		process.env.SEMANTIC_ALLOWLIST_SOFT_MAX = String(localSoft);
		const eligibleCount = countEligibleForOpts(fc.opts);
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
	}
	if (prevSoft === undefined) delete process.env.SEMANTIC_ALLOWLIST_SOFT_MAX;
	else process.env.SEMANTIC_ALLOWLIST_SOFT_MAX = prevSoft;
	killWorker(filterWorker);

	const afterSource = fingerprintFile(absSource);
	assertSourceUnchanged(before, afterSource);

	const peakRss = Math.max(
		Number((bitReports['2bit'] as { memory: { python_worker_peak_rss_during_index_mb: number } })
			.memory.python_worker_peak_rss_during_index_mb || 0),
		Number((bitReports['4bit'] as { memory: { python_worker_peak_rss_during_index_mb: number } })
			.memory.python_worker_peak_rss_during_index_mb || 0)
	);
	const recommendedRamGb =
		peakRss <= 0 ? null : peakRss < 700 ? 2 : peakRss < 1400 ? 4 : peakRss < 2800 ? 8 : Math.ceil((peakRss * 1.75) / 1024);

	const meanOverlap = mean(overlaps);
	const bytes2 = (bitReports['2bit'] as { indexing: { index_bytes: number | null } }).indexing
		.index_bytes;
	const bytes4 = (bitReports['4bit'] as { indexing: { index_bytes: number | null } }).indexing
		.index_bytes;
	const lat2 = (bitReports['2bit'] as { latency: { hybrid: { p95_ms: number } } }).latency.hybrid
		.p95_ms;
	const lat4 = (bitReports['4bit'] as { latency: { hybrid: { p95_ms: number } } }).latency.hybrid
		.p95_ms;

	// Prefer 4-bit only when overlap disagreement is material or human review would
	// clearly benefit; default evidence from synthetic said 4-bit closer to exact.
	// On real archive we use mean top-10 semantic overlap + disk/latency delta.
	let chosenBits: 2 | 4 = 2;
	let bitsRationale =
		'Defaulting to 2-bit pending stronger real-archive quality evidence favoring 4-bit.';
	if (
		typeof bytes2 === 'number' &&
		typeof bytes4 === 'number' &&
		bytes4 / Math.max(bytes2, 1) < 3 &&
		Math.abs(lat4 - lat2) < 25 &&
		meanOverlap < 0.85
	) {
		chosenBits = 4;
		bitsRationale = `4-bit recommended: mean semantic top-10 overlap vs 2-bit=${meanOverlap.toFixed(3)} (material disagreement), disk ratio=${(bytes4 / bytes2).toFixed(2)}×, hybrid p95 delta=${(lat4 - lat2).toFixed(1)}ms.`;
	} else if (meanOverlap >= 0.9) {
		chosenBits = 2;
		bitsRationale = `2-bit recommended: rankings nearly agree with 4-bit (mean overlap ${meanOverlap.toFixed(3)}); keep smaller index.`;
	}

	const durable2 = (bitReports['2bit'] as { restart: { removed_still_absent: boolean; ids_stable: boolean } })
		.restart;
	const durable4 = (bitReports['4bit'] as { restart: { removed_still_absent: boolean; ids_stable: boolean } })
		.restart;
	const goArchitecture =
		!filterFailed && durable2.removed_still_absent && durable4.removed_still_absent;

	let verdict: 'GO_MERGE_AND_ENABLE_BEHIND_FLAG' | 'GO_MERGE_KEEP_FLAG_OFF' | 'NO_GO' = 'NO_GO';
	if (!goArchitecture) verdict = 'NO_GO';
	else verdict = 'GO_MERGE_KEEP_FLAG_OFF'; // enable-behind-flag needs human review pack sign-off

	const recommendation = {
		verdict,
		production_gate_passed: true,
		do_not_merge_automatically: true,
		chosen_vector_bits: chosenBits,
		bits_rationale: bitsRationale,
		mean_semantic_top10_overlap_2_vs_4: meanOverlap,
		railway: {
			measured_python_worker_peak_rss_mb: peakRss,
			suggested_ram_gb: recommendedRamGb,
			suggested_vcpu: 1,
			persistent_volume_note:
				'Size for SQLite + temporary/rebuild TurboVec indexes; 2-bit≈index_bytes, 4-bit larger. Keep worker private.'
		},
		filter_failed: filterFailed,
		limitations: [
			'Human must inspect HUMAN_REVIEW.md before enabling the flag',
			'README text availability depends on archive snapshot files present beside the DB copy',
			'This run must not mutate the operator source file (verified by fingerprint)'
		]
	};

	const full = {
		generated_at: new Date().toISOString(),
		git_head: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
		source_fingerprint: before,
		source_unchanged: true,
		work_db: workDb,
		inventory,
		bitReports,
		filterResults,
		recommendation,
		query_count: SNAPSHOT_QUERIES.length
	};

	writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(full, null, 2));
	writeFileSync(path.join(OUT_DIR, 'HUMAN_REVIEW.md'), renderHumanReview(review));
	writeFileSync(
		path.join(OUT_DIR, 'GATE_STATUS.json'),
		JSON.stringify(
			{
				verdict,
				production_gate_passed: true,
				do_not_merge: true,
				chosen_vector_bits: chosenBits,
				git_head: full.git_head
			},
			null,
			2
		)
	);
	writeFileSync(
		path.join(OUT_DIR, 'REPORT.md'),
		[
			'# Production-snapshot gate report',
			'',
			`Generated: ${full.generated_at}`,
			'',
			`## Verdict: **${verdict}**`,
			'',
			'Do **not** merge automatically. Human review of `HUMAN_REVIEW.md` required before enabling the flag.',
			'',
			'## Inventory',
			'```json',
			JSON.stringify(inventory, null, 2),
			'```',
			'',
			'## 2-bit / 4-bit',
			'```json',
			JSON.stringify(bitReports, null, 2),
			'```',
			'',
			'## Filters',
			'```json',
			JSON.stringify(filterResults, null, 2),
			'```',
			'',
			'## Recommendation',
			'```json',
			JSON.stringify(recommendation, null, 2),
			'```'
		].join('\n')
	);

	closeDb();
	assertSourceUnchanged(before, fingerprintFile(absSource));
	console.log(JSON.stringify(recommendation, null, 2));
	return full;
}

async function main() {
	const args = process.argv.slice(2);
	const safetyProof = args.includes('--safety-proof');
	mkdirSync(OUT_DIR, { recursive: true });

	if (safetyProof) {
		await runSafetyProof();
		process.exit(2); // blocked for production gate
	}

	const source = process.env.SEMANTIC_PROD_SNAPSHOT_SOURCE?.trim();
	if (!source) {
		const body = writeBlockedArtifacts({
			railway_mcp: 'unavailable',
			railway_cli: 'not installed / not authenticated'
		});
		console.error(JSON.stringify(body, null, 2));
		process.exit(2);
	}

	await runFullGate(source);
}

main().catch((err) => {
	console.error(err);
	writeBlockedArtifacts({ error: String(err) });
	process.exit(1);
});
