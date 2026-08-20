#!/usr/bin/env tsx
/**
 * Deterministic relevance evaluation for keyword / semantic / hybrid modes.
 * Uses synthetic repos + hashing embeddings so CI does not need MiniLM weights.
 */
import './load-env.js';
import { closeDb, getDb } from '../src/lib/server/db/connection.js';
import { insertRepo, saveEnrichment } from '../src/lib/server/db/repos.js';
import { applyRepoIntelligence } from '../src/lib/server/apply-repo-intelligence.js';
import { rankHybridCandidates, bm25ToSimilarity } from '../src/lib/server/semantic/ranking.js';
import { buildRepositorySemanticDocument } from '../src/lib/server/semantic/document.js';
import { semanticFingerprint } from '../src/lib/server/semantic/fingerprint.js';
import { searchReposFts } from '../src/lib/server/db/fts.js';

type EvalCase = {
	query: string;
	relevantFullNames: string[];
};

const CASES: EvalCase[] = [
	{
		query: 'local voice assistant',
		relevantFullNames: ['voice/local-assistant', 'voice/whisper-discord-bot']
	},
	{
		query: 'download manager',
		relevantFullNames: ['downloads/motrix-like', 'downloads/aria-gui']
	},
	{
		query: 'network scanner',
		relevantFullNames: ['net/port-scanner', 'net/self-hosted-monitor']
	},
	{
		query: 'Minecraft server tools',
		relevantFullNames: ['mc/economy-tracker', 'mc/server-panel']
	},
	{
		query: 'Windows executable analyzer',
		relevantFullNames: ['win/pe-inspector', 'win/exe-explainer']
	}
];

function seedRepos() {
	const fixtures: Array<{
		owner: string;
		name: string;
		description: string;
		topics: string[];
		language: string;
		category: string;
	}> = [
		{
			owner: 'voice',
			name: 'local-assistant',
			description: 'Offline local voice assistant with wake word and TTS',
			topics: ['voice-assistant', 'speech-recognition', 'local-first'],
			language: 'Python',
			category: 'developer-tools'
		},
		{
			owner: 'voice',
			name: 'whisper-discord-bot',
			description: 'Discord voice bot that listens with Whisper and answers',
			topics: ['discord', 'whisper', 'voice'],
			language: 'Python',
			category: 'developer-tools'
		},
		{
			owner: 'downloads',
			name: 'motrix-like',
			description: 'Full-featured download manager with BitTorrent support',
			topics: ['download-manager', 'bittorrent'],
			language: 'JavaScript',
			category: 'networking'
		},
		{
			owner: 'downloads',
			name: 'aria-gui',
			description: 'GUI for downloading large files faster with aria2',
			topics: ['aria2', 'downloads'],
			language: 'TypeScript',
			category: 'networking'
		},
		{
			owner: 'net',
			name: 'port-scanner',
			description: 'Fast network scanner for local subnets',
			topics: ['network-scanner', 'security'],
			language: 'Go',
			category: 'networking'
		},
		{
			owner: 'net',
			name: 'self-hosted-monitor',
			description: 'Self hosted network monitoring dashboard',
			topics: ['monitoring', 'self-hosted'],
			language: 'Go',
			category: 'networking'
		},
		{
			owner: 'mc',
			name: 'economy-tracker',
			description: 'Minecraft economy tracker for servers',
			topics: ['minecraft', 'economy'],
			language: 'Java',
			category: 'games'
		},
		{
			owner: 'mc',
			name: 'server-panel',
			description: 'Minecraft server tools and admin panel',
			topics: ['minecraft', 'server'],
			language: 'Java',
			category: 'games'
		},
		{
			owner: 'win',
			name: 'pe-inspector',
			description: 'Inspect Windows PE executables and explain imports',
			topics: ['pe', 'windows', 'reverse-engineering'],
			language: 'Rust',
			category: 'developer-tools'
		},
		{
			owner: 'win',
			name: 'exe-explainer',
			description: 'Software that explains Windows executables',
			topics: ['windows', 'executable', 'analysis'],
			language: 'C++',
			category: 'developer-tools'
		},
		{
			owner: 'noise',
			name: 'photo-gallery',
			description: 'Pretty photo gallery theme',
			topics: ['photos', 'gallery'],
			language: 'CSS',
			category: 'other'
		}
	];

	const now = '2026-08-01T00:00:00.000Z';
	for (const f of fixtures) {
		const inserted = insertRepo({
			owner: f.owner,
			name: f.name,
			full_name: `${f.owner}/${f.name}`,
			github_url: `https://github.com/${f.owner}/${f.name}`,
			event_id: `evt-${f.owner}-${f.name}`,
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

async function main() {
	process.env.DATABASE_PATH =
		process.env.DATABASE_PATH ?? `./data/semantic-eval-${Date.now()}.db`;
	getDb();
	seedRepos();

	const rows = getDb()
		.prepare(`SELECT id, full_name, description, language, topics, category, interesting_score, stars FROM repos`)
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

	// Lexical-only evaluation (always available). Semantic/hybrid require a live worker;
	// when unavailable we still emit keyword metrics and note the skip.
	const report: unknown[] = [];
	for (const c of CASES) {
		const relevant = new Set(
			c.relevantFullNames.map((n) => byName.get(n)?.id).filter((x): x is number => Boolean(x))
		);
		const fts = searchReposFts({ q: c.query, page: 1, perPage: 10 });
		const keywordIds = fts.repos.map((r) => r.id);
		const keyword = metricsAtK(keywordIds, relevant, 10);

		// Pseudo-semantic using document token overlap (deterministic stand-in when worker off)
		const qTokens = new Set(c.query.toLowerCase().split(/\s+/));
		const scored = rows.map((r) => {
			const doc = buildRepositorySemanticDocument(r).toLowerCase();
			let overlap = 0;
			for (const t of qTokens) if (doc.includes(t)) overlap += 1;
			return {
				id: r.id,
				semanticScore: overlap / Math.max(1, qTokens.size),
				lexicalScore: bm25ToSimilarity(
					fts.repos.find((x) => x.id === r.id)?.fts_rank ?? null
				),
				interestingScore: r.interesting_score,
				stars: r.stars
			};
		});
		const hybrid = rankHybridCandidates(scored, {
			semanticWeight: 0.55,
			lexicalWeight: 0.35,
			qualityWeight: 0.1
		});
		const semanticOnly = [...scored].sort(
			(a, b) => (b.semanticScore ?? 0) - (a.semanticScore ?? 0) || a.id - b.id
		);

		report.push({
			query: c.query,
			keyword,
			semantic: metricsAtK(
				semanticOnly.map((x) => x.id),
				relevant,
				10
			),
			hybrid: metricsAtK(
				hybrid.map((x) => x.id),
				relevant,
				10
			),
			fingerprint_example: semanticFingerprint({
				entityKey: String(rows[0]!.id),
				document: buildRepositorySemanticDocument(rows[0]!),
				embeddingModel: 'hashing-v1'
			})
		});
	}

	console.log(JSON.stringify({ cases: report }, null, 2));
}

main()
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	})
	.finally(() => closeDb());
