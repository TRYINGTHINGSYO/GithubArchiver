import { getDb } from '../db/connection.js';
import { buildRepoFilters } from '../db/repo-query.js';
import { searchReposFts } from '../db/fts.js';
import { queryRepos } from '../db/repos.js';
import type { RepoQuery, RepoQueryResult, RepoRow } from '../db/types.js';
import { getSemanticConfig, isSemanticSearchEnabled, type SemanticSearchMode } from './config.js';
import { semanticWorkerHealth, semanticWorkerSearch } from './client.js';
import { bm25ToSimilarity, rankHybridCandidates } from './ranking.js';

export interface SemanticRepoHit extends RepoRow {
	fts_rank: number | null;
	fts_snippet: string | null;
	semantic_score: number | null;
	final_score: number | null;
	match_reason: 'semantic' | 'lexical' | 'hybrid' | 'quality' | null;
}

export interface SemanticRepoQueryResult extends RepoQueryResult {
	repos: SemanticRepoHit[];
	searchMode: SemanticSearchMode;
	semanticAvailable: boolean;
}

function hasHardFilters(opts: RepoQuery): boolean {
	return Boolean(
		opts.language ||
			opts.source ||
			opts.year ||
			opts.dateFrom ||
			opts.dateTo ||
			opts.minStars != null ||
			opts.maxStars != null ||
			opts.minForks != null ||
			opts.category ||
			opts.signalTier ||
			opts.minInterestingScore != null ||
			opts.cluster ||
			opts.clusters?.length ||
			opts.archivedOnly ||
			opts.hasReadme ||
			opts.hasRelease ||
			opts.deletedOnly ||
			opts.neverEnriched
	);
}

function listEligibleRepoIds(opts: RepoQuery, softMax: number): {
	ids: number[];
	truncated: boolean;
	totalEligible: number;
} {
	const db = getDb();
	const { clause, params } = buildRepoFilters({ ...opts, q: undefined });
	const filterSql = clause ? clause : 'WHERE 1=1';
	const totalRow = db
		.prepare(`SELECT COUNT(*) AS c FROM repos ${filterSql}`)
		.get(...params) as { c: number };
	const totalEligible = totalRow.c;
	const ids = (
		db
			.prepare(`SELECT id FROM repos ${filterSql} ORDER BY id ASC LIMIT ?`)
			.all(...params, softMax + 1) as { id: number }[]
	).map((r) => r.id);
	const truncated = ids.length > softMax;
	return {
		ids: truncated ? ids.slice(0, softMax) : ids,
		truncated,
		totalEligible
	};
}

function loadReposByIds(ids: number[]): RepoRow[] {
	if (ids.length === 0) return [];
	const db = getDb();
	const placeholders = ids.map(() => '?').join(', ');
	const rows = db
		.prepare(`SELECT * FROM repos WHERE id IN (${placeholders})`)
		.all(...ids) as RepoRow[];
	const byId = new Map(rows.map((r) => [r.id, r]));
	return ids.map((id) => byId.get(id)).filter((r): r is RepoRow => Boolean(r));
}

export async function searchReposSemanticAware(
	opts: RepoQuery & { searchMode?: SemanticSearchMode }
): Promise<SemanticRepoQueryResult> {
	const config = getSemanticConfig();
	const mode: SemanticSearchMode =
		opts.searchMode ?? (config.enabled ? config.defaultMode : 'keyword');
	const page = opts.page ?? 1;
	const perPage = opts.perPage ?? 50;

	const empty = (semanticAvailable: boolean): SemanticRepoQueryResult => ({
		repos: [],
		total: 0,
		page,
		perPage,
		totalPages: 1,
		searchMode: mode,
		semanticAvailable
	});

	if (!opts.q?.trim()) {
		const plain = queryRepos({ ...opts, q: undefined });
		return {
			...plain,
			repos: plain.repos.map((r) => ({
				...r,
				fts_rank: null,
				fts_snippet: null,
				semantic_score: null,
				final_score: null,
				match_reason: null
			})),
			searchMode: 'keyword',
			semanticAvailable: false
		};
	}

	const wantSemantic =
		config.enabled && (mode === 'semantic' || mode === 'hybrid');
	let semanticAvailable = false;
	let healthOk = false;

	if (wantSemantic) {
		const health = await semanticWorkerHealth();
		healthOk = Boolean(health?.ok);
		semanticAvailable = healthOk;
	}

	if (!wantSemantic || !healthOk) {
		const fts = searchReposFts(opts);
		return {
			...fts,
			repos: fts.repos.map((r) => ({
				...r,
				semantic_score: null,
				final_score: r.fts_rank != null ? bm25ToSimilarity(r.fts_rank) : null,
				match_reason: 'lexical' as const
			})),
			searchMode: mode === 'keyword' || !config.enabled ? 'keyword' : mode,
			semanticAvailable: false
		};
	}

	const candidateLimit = Math.min(500, Math.max(perPage * 5, 50));
	let allowlist: number[] | undefined;
	let allowlistTruncated = false;

	if (hasHardFilters(opts)) {
		const eligible = listEligibleRepoIds(opts, config.allowlistSoftMax);
		allowlistTruncated = eligible.truncated;
		if (eligible.ids.length === 0) return empty(true);
		if (!eligible.truncated) {
			allowlist = eligible.ids;
		}
		// If truncated, search without allowlist and post-filter (documented fallback).
	}

	let semanticHits: Array<{ vectorId: number; score: number }> = [];
	try {
		semanticHits = await semanticWorkerSearch({
			query: opts.q,
			k: candidateLimit,
			allowlist
		});
	} catch {
		const fts = searchReposFts(opts);
		return {
			...fts,
			repos: fts.repos.map((r) => ({
				...r,
				semantic_score: null,
				final_score: r.fts_rank != null ? bm25ToSimilarity(r.fts_rank) : null,
				match_reason: 'lexical' as const
			})),
			searchMode: mode,
			semanticAvailable: false
		};
	}

	const semanticScoreById = new Map<number, number>();
	for (const hit of semanticHits) {
		semanticScoreById.set(hit.vectorId, hit.score);
	}

	let lexicalById = new Map<
		number,
		{ lexicalScore: number | null; snippet: string | null; row: RepoRow }
	>();

	if (mode === 'hybrid' || mode === 'keyword') {
		const fts = searchReposFts({
			...opts,
			page: 1,
			perPage: candidateLimit
		});
		for (const row of fts.repos) {
			lexicalById.set(row.id, {
				lexicalScore: bm25ToSimilarity(row.fts_rank),
				snippet: row.fts_snippet,
				row
			});
		}
	}

	const idSet = new Set<number>([
		...semanticScoreById.keys(),
		...lexicalById.keys()
	]);

	// Post-filter when allowlist was truncated or semantic-only without allowlist.
	if (hasHardFilters(opts) && (allowlistTruncated || !allowlist)) {
		const eligible = new Set(listEligibleRepoIds(opts, config.allowlistSoftMax * 2).ids);
		for (const id of [...idSet]) {
			if (!eligible.has(id)) idSet.delete(id);
		}
	}

	const missingIds = [...idSet].filter((id) => !lexicalById.has(id));
	const loaded = loadReposByIds(missingIds);
	for (const row of loaded) {
		lexicalById.set(row.id, {
			lexicalScore: null,
			snippet: null,
			row
		});
	}

	if (mode === 'semantic') {
		// Drop pure-lexical-only ids when user asked for semantic-only.
		for (const id of [...idSet]) {
			if (!semanticScoreById.has(id)) idSet.delete(id);
		}
	}

	const candidates = [...idSet].map((id) => {
		const lex = lexicalById.get(id);
		const row = lex?.row;
		return {
			id,
			semanticScore: semanticScoreById.get(id) ?? null,
			lexicalScore: mode === 'semantic' ? null : (lex?.lexicalScore ?? null),
			interestingScore: row?.interesting_score ?? null,
			stars: row?.stars ?? null,
			signalTier: row?.signal_tier ?? null,
			snippet: lex?.snippet ?? null,
			row
		};
	}).filter((c) => c.row);

	const ranked = rankHybridCandidates(
		candidates.map((c) => ({
			id: c.id,
			semanticScore: c.semanticScore,
			lexicalScore: c.lexicalScore,
			interestingScore: c.interestingScore,
			stars: c.stars,
			signalTier: c.signalTier
		})),
		{
			semanticWeight: mode === 'semantic' ? 1 : config.semanticWeight,
			lexicalWeight: mode === 'semantic' ? 0 : config.lexicalWeight,
			qualityWeight: config.qualityWeight
		}
	);

	const total = ranked.length;
	const offset = (page - 1) * perPage;
	const pageRows = ranked.slice(offset, offset + perPage);
	const byId = new Map(candidates.map((c) => [c.id, c]));

	const repos: SemanticRepoHit[] = pageRows.map((r) => {
		const base = byId.get(r.id)!;
		return {
			...base.row!,
			fts_rank: base.lexicalScore != null ? 1 / Math.max(base.lexicalScore, 1e-9) - 1 : null,
			fts_snippet: base.snippet,
			semantic_score: r.semanticScore ?? null,
			final_score: r.finalScore,
			match_reason: r.matchReason
		};
	});

	return {
		repos,
		total,
		page,
		perPage,
		totalPages: Math.max(1, Math.ceil(total / perPage)),
		searchMode: mode,
		semanticAvailable
	};
}
