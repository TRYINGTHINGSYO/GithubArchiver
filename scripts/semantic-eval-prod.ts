#!/usr/bin/env tsx
/**
 * Optional production MiniLM relevance evaluation.
 *
 * Unlike semantic-eval.ts (hashing / token-overlap CI stand-in), this uses the
 * real sentence-transformers/all-MiniLM-L6-v2 embedder when installed.
 *
 * Fixtures are chosen so keyword overlap alone should not ace the set —
 * relevant descriptions omit the query's primary content words.
 *
 * Skip (exit 0) when sentence-transformers is unavailable.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './load-env.js';
import { closeDb, getDb } from '../src/lib/server/db/connection.js';
import { insertRepo, saveEnrichment } from '../src/lib/server/db/repos.js';
import { applyRepoIntelligence } from '../src/lib/server/apply-repo-intelligence.js';
import { searchReposFts } from '../src/lib/server/db/fts.js';
import { buildRepositorySemanticDocument } from '../src/lib/server/semantic/document.js';
import { rankHybridCandidates, bm25ToSimilarity } from '../src/lib/server/semantic/ranking.js';

type EvalCase = {
	id: string;
	query: string;
	relevantFullNames: string[];
};

const MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

/** Meaning-oriented queries: relevant docs avoid the query's primary content words. */
const CASES: EvalCase[] = [
	{
		id: 'voice-channel-bot',
		query: 'program that talks back to people in a voice channel',
		relevantFullNames: ['voice/whisper-discord-bot']
	},
	{
		id: 'windows-pe',
		query: 'figure out what a Windows program does',
		relevantFullNames: ['win/pe-inspector']
	},
	{
		id: 'network-watch',
		query: 'keep an eye on machines on my network',
		relevantFullNames: ['net/infra-dashboard']
	}
];

const FIXTURES: Array<{
	owner: string;
	name: string;
	description: string;
	topics: string[];
	language: string;
	category: string;
}> = [
	{
		owner: 'voice',
		name: 'whisper-discord-bot',
		description: 'Discord bot using Whisper speech recognition and TTS',
		topics: ['discord', 'whisper', 'tts'],
		language: 'Python',
		category: 'developer-tools'
	},
	{
		owner: 'win',
		name: 'pe-inspector',
		description: 'PE executable inspection and import analysis',
		topics: ['pe', 'imports', 'binaries'],
		language: 'Rust',
		category: 'developer-tools'
	},
	{
		owner: 'net',
		name: 'infra-dashboard',
		description: 'self-hosted infrastructure monitoring dashboard',
		topics: ['monitoring', 'self-hosted', 'ops'],
		language: 'Go',
		category: 'networking'
	},
	{
		owner: 'noise',
		name: 'photo-gallery',
		description: 'Pretty photo gallery theme for static sites',
		topics: ['photos', 'gallery'],
		language: 'CSS',
		category: 'other'
	},
	{
		owner: 'noise',
		name: 'csv-merger',
		description: 'Merge CSV spreadsheets from the command line',
		topics: ['csv', 'cli'],
		language: 'Python',
		category: 'developer-tools'
	},
	{
		owner: 'noise',
		name: 'markdown-notes',
		description: 'Local markdown notebook with tags',
		topics: ['notes', 'markdown'],
		language: 'TypeScript',
		category: 'other'
	},
	{
		owner: 'noise',
		name: 'game-sprite-packer',
		description: 'Pack game sprites into texture atlases',
		topics: ['gamedev', 'sprites'],
		language: 'C++',
		category: 'games'
	},
	{
		owner: 'noise',
		name: 'recipe-scaler',
		description: 'Scale cooking recipes by serving count',
		topics: ['cooking', 'recipes'],
		language: 'JavaScript',
		category: 'other'
	}
];

function seedRepos() {
	const now = '2026-08-01T00:00:00.000Z';
	for (const f of FIXTURES) {
		const inserted = insertRepo({
			owner: f.owner,
			name: f.name,
			full_name: `${f.owner}/${f.name}`,
			github_url: `https://github.com/${f.owner}/${f.name}`,
			event_id: `evt-prod-${f.owner}-${f.name}`,
			created_at: now,
			first_seen_at: now,
			discovery_source: 'manual'
		});
		saveEnrichment(inserted.id!, {
			default_branch: 'main',
			description: f.description,
			language: f.language,
			stars: 50,
			forks: 1,
			watchers: 50,
			license: 'MIT',
			topics: f.topics,
			pushed_at: now,
			updated_at: now
		});
		const row = getDb().prepare('SELECT * FROM repos WHERE id = ?').get(inserted.id) as never;
		applyRepoIntelligence(row, {
			default_branch: 'main',
			description: f.description,
			language: f.language,
			stars: 50,
			forks: 1,
			watchers: 50,
			license: 'MIT',
			topics: f.topics,
			pushed_at: now,
			updated_at: now
		});
		getDb()
			.prepare(`UPDATE repos SET category = ?, summary = ? WHERE id = ?`)
			.run(f.category, f.description, inserted.id);
	}
}

function metricsAtK(rankedIds: number[], relevant: Set<number>, k: number) {
	const top = rankedIds.slice(0, k);
	const hits = top.filter((id) => relevant.has(id));
	const precision = hits.length / k;
	const recall = relevant.size ? hits.length / relevant.size : 0;
	let mrr = 0;
	for (let i = 0; i < top.length; i++) {
		if (relevant.has(top[i]!)) {
			mrr = 1 / (i + 1);
			break;
		}
	}
	return { precision, recall, mrr };
}

function mean(xs: number[]) {
	return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function runMiniLmScores(payload: unknown): {
	ok: boolean;
	scores?: Record<string, Array<[number, number]>>;
	error?: string;
	skipped?: boolean;
} {
	const script = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		'..',
		'services',
		'semantic-worker',
		'eval_prod_embed.py'
	);
	const result = spawnSync('python3', [script], {
		input: JSON.stringify(payload),
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024
	});
	if (result.status === 2) {
		return { ok: false, skipped: true, error: result.stderr.trim() || 'sentence-transformers missing' };
	}
	if (result.status !== 0) {
		return {
			ok: false,
			error: result.stderr.trim() || result.stdout.trim() || `python exited ${result.status}`
		};
	}
	const parsed = JSON.parse(result.stdout) as {
		ok: boolean;
		scores: Record<string, Array<[number, number]>>;
	};
	return parsed;
}

async function main() {
	process.env.DATABASE_PATH =
		process.env.DATABASE_PATH ?? `./data/semantic-eval-prod-${Date.now()}.db`;
	getDb();
	seedRepos();

	const rows = getDb()
		.prepare(
			`SELECT id, full_name, description, language, topics, category, interesting_score, stars FROM repos`
		)
		.all() as Array<{
		id: number;
		full_name: string;
		description: string | null;
		language: string | null;
		topics: string | null;
		category: string | null;
		interesting_score: number | null;
		stars: number | null;
	}>;
	const byName = new Map(rows.map((r) => [r.full_name, r]));

	const embedPayload = {
		model: MODEL,
		queries: CASES.map((c) => ({ id: c.id, text: c.query })),
		documents: rows.map((r) => ({
			id: r.id,
			text: buildRepositorySemanticDocument(r)
		}))
	};

	const embedded = runMiniLmScores(embedPayload);
	if (embedded.skipped) {
		console.log(
			JSON.stringify(
				{
					skipped: true,
					reason: 'sentence-transformers not installed',
					hint: 'pip install -r services/semantic-worker/requirements-prod.txt',
					model: MODEL
				},
				null,
				2
			)
		);
		return;
	}
	if (!embedded.ok || !embedded.scores) {
		console.error(embedded.error ?? 'MiniLM eval failed');
		process.exitCode = 1;
		return;
	}

	const perCase: unknown[] = [];
	const keywordRecalls: number[] = [];
	const semanticRecalls: number[] = [];
	const hybridRecalls: number[] = [];
	const keywordPrecisions: number[] = [];
	const semanticPrecisions: number[] = [];
	const hybridPrecisions: number[] = [];
	const keywordMrrs: number[] = [];
	const semanticMrrs: number[] = [];
	const hybridMrrs: number[] = [];

	for (const c of CASES) {
		const relevant = new Set(
			c.relevantFullNames.map((n) => byName.get(n)?.id).filter((x): x is number => Boolean(x))
		);
		const fts = searchReposFts({ q: c.query, page: 1, perPage: 10 });
		const keywordIds = fts.repos.map((r) => r.id);
		const keyword = metricsAtK(keywordIds, relevant, 10);

		const semanticRanked = (embedded.scores[c.id] ?? []).map(([id, score]) => ({
			id,
			semanticScore: score,
			lexicalScore: bm25ToSimilarity(
				fts.repos.find((x) => x.id === id)?.fts_rank ?? null
			),
			interestingScore: rows.find((r) => r.id === id)?.interesting_score ?? null,
			stars: rows.find((r) => r.id === id)?.stars ?? null
		}));

		const semantic = metricsAtK(
			semanticRanked.map((x) => x.id),
			relevant,
			10
		);
		const hybridRanked = rankHybridCandidates(semanticRanked, {
			semanticWeight: 0.55,
			lexicalWeight: 0.35,
			qualityWeight: 0.1
		});
		const hybrid = metricsAtK(
			hybridRanked.map((x) => x.id),
			relevant,
			10
		);

		keywordRecalls.push(keyword.recall);
		semanticRecalls.push(semantic.recall);
		hybridRecalls.push(hybrid.recall);
		keywordPrecisions.push(keyword.precision);
		semanticPrecisions.push(semantic.precision);
		hybridPrecisions.push(hybrid.precision);
		keywordMrrs.push(keyword.mrr);
		semanticMrrs.push(semantic.mrr);
		hybridMrrs.push(hybrid.mrr);

		const idToName = new Map(rows.map((r) => [r.id, r.full_name]));
		perCase.push({
			id: c.id,
			query: c.query,
			relevant: c.relevantFullNames,
			keyword,
			semantic,
			hybrid,
			keywordTop: keywordIds.slice(0, 3).map((id) => idToName.get(id)),
			semanticTop: semanticRanked.slice(0, 3).map((x) => idToName.get(x.id))
		});
	}

	const report = {
		model: MODEL,
		k: 10,
		cases: perCase,
		macro: {
			keyword: {
				recallAt10: mean(keywordRecalls),
				precisionAt10: mean(keywordPrecisions),
				mrr: mean(keywordMrrs)
			},
			semantic: {
				recallAt10: mean(semanticRecalls),
				precisionAt10: mean(semanticPrecisions),
				mrr: mean(semanticMrrs)
			},
			hybrid: {
				recallAt10: mean(hybridRecalls),
				precisionAt10: mean(hybridPrecisions),
				mrr: mean(hybridMrrs)
			}
		},
		note: 'Keyword should not dominate these fixtures; semantic/hybrid use MiniLM meaning.'
	};
	console.log(JSON.stringify(report, null, 2));
}

main()
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	})
	.finally(() => closeDb());
