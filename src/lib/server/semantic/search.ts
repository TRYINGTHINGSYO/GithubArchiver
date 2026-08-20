/**
 * Always apply the same SQLite visibility/eligibility rules used by ordinary
 * repository search (buildRepoFilters), including when the user supplied no
 * explicit hard filters. TurboVec hits alone are never sufficient.
 */
import { getDb } from '../db/connection.js';
import { buildRepoFilters } from '../db/repo-query.js';
import { searchReposFts, type RepoFtsRow } from '../db/fts.js';
import { queryRepos } from '../db/repos.js';
import type { RepoQuery, RepoQueryResult, RepoRow } from '../db/types.js';
import { checkWorkerCompatibility } from './compatibility.js';
import { getSemanticConfig, isSemanticSearchEnabled, type SemanticSearchMode } from './config.js';
import { semanticWorkerHealth, semanticWorkerSearch } from './client.js';
import { bm25ToSimilarity, rankHybridCandidates, similarityToBm25 } from './ranking.js';

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
	/**
	 * Semantic/hybrid pagination ranks a bounded retrieval window, then pages
	 * within that window. `total` / `totalPages` describe the window — not the
	 * full corpus size.
	 */
	pagination: 'candidate-window' | 'fts' | 'list';
	/** How TurboVec candidates were constrained (observability / readiness). */
	retrievalPath?: 'allowlist' | 'post-filter' | 'unfiltered' | 'fts' | 'list';
}

function hasExplicitHardFilters(opts: RepoQuery): boolean {
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

function countEligibleRepos(opts: RepoQuery): number {
	const db = getDb();
	const { clause, params } = buildRepoFilters({ ...opts, q: undefined });
	const filterSql = clause ? clause : 'WHERE 1=1';
	const totalRow = db
		.prepare(`SELECT COUNT(*) AS c FROM repos ${filterSql}`)
		.get(...params) as { c: number };
	return totalRow.c;
}

function listEligibleRepoIds(opts: RepoQuery, softMax: number): {
	ids: number[];
	truncated: boolean;
	totalEligible: number;
} {
	const db = getDb();
	const { clause, params } = buildRepoFilters({ ...opts, q: undefined });
	const filterSql = clause ? clause : 'WHERE 1=1';
	const totalEligible = countEligibleRepos(opts);
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

/**
 * Apply the complete SQL filter set (including baseline deleted/pending-deletion
 * visibility) to an explicit candidate id list. Shared by keyword and semantic
 * paths so eligibility cannot drift.
 */
export function filterRepoIdsByQuery(ids: number[], opts: RepoQuery): number[] {
	if (ids.length === 0) return [];
	const db = getDb();
	const { clause, params } = buildRepoFilters({ ...opts, q: undefined });
	const filterSql = clause ? clause.replace(/^WHERE\s+/i, 'AND ') : '';
	const placeholders = ids.map(() => '?').join(', ');
	const rows = db
		.prepare(
			`SELECT id FROM repos
			 WHERE id IN (${placeholders})
			 ${filterSql}`
		)
		.all(...ids, ...params) as { id: number }[];
	const allowed = new Set(rows.map((r) => r.id));
	return ids.filter((id) => allowed.has(id));
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

function ftsFallback(
	opts: RepoQuery,
	mode: SemanticSearchMode,
	configEnabled: boolean
): SemanticRepoQueryResult {
	const fts = searchReposFts(opts);
	const ftsRepos = fts.repos as RepoFtsRow[];
	return {
		...fts,
		repos: ftsRepos.map((r) => ({
			...r,
			fts_rank: r.fts_rank,
			fts_snippet: r.fts_snippet,
			semantic_score: null,
			final_score: r.fts_rank != null ? bm25ToSimilarity(r.fts_rank) : null,
			match_reason: 'lexical' as const
		})),
		searchMode: mode === 'keyword' || !configEnabled ? 'keyword' : mode,
		semanticAvailable: false,
		pagination: 'fts',
		retrievalPath: 'fts'
	};
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
		semanticAvailable,
		pagination: 'candidate-window',
		retrievalPath: 'unfiltered'
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
			semanticAvailable: false,
			pagination: 'list',
			retrievalPath: 'list'
		};
	}

	const wantSemantic =
		config.enabled && (mode === 'semantic' || mode === 'hybrid');
	let semanticAvailable = false;

	if (wantSemantic) {
		const health = await semanticWorkerHealth();
		const compat = checkWorkerCompatibility(health, config);
		if (!compat.ok) {
			return ftsFallback(opts, mode, config.enabled);
		}
		semanticAvailable = true;
	}

	if (!wantSemantic || !semanticAvailable) {
		return ftsFallback(opts, mode, config.enabled);
	}

	const candidateLimit = Math.min(500, Math.max(perPage * 5, 50));
	let allowlist: number[] | undefined;
	let useCandidatePostFilter = false;

	// Baseline eligibility (deleted_at / pending_deletion_at / …) always comes
	// from buildRepoFilters via filterRepoIdsByQuery after retrieval. Explicit
	// user filters may additionally drive TurboVec allowlists when small enough.
	if (hasExplicitHardFilters(opts)) {
		const eligible = listEligibleRepoIds(opts, config.allowlistSoftMax);
		if (eligible.totalEligible === 0) return empty(true);
		if (!eligible.truncated) {
			allowlist = eligible.ids;
		} else {
			useCandidatePostFilter = true;
		}
	}

	const retrievalK = useCandidatePostFilter
		? Math.min(2_000, Math.max(candidateLimit * 4, perPage * 20))
		: candidateLimit;

	let semanticHits: Array<{ vectorId: number; score: number }> = [];
	try {
		semanticHits = await semanticWorkerSearch({
			query: opts.q,
			k: retrievalK,
			allowlist
		});
	} catch {
		return ftsFallback(opts, mode, config.enabled);
	}

	const semanticScoreById = new Map<number, number>();
	for (const hit of semanticHits) {
		semanticScoreById.set(hit.vectorId, hit.score);
	}

	const lexicalById = new Map<
		number,
		{ lexicalScore: number | null; snippet: string | null; row: RepoRow }
	>();

	if (mode === 'hybrid') {
		const fts = searchReposFts({
			...opts,
			page: 1,
			perPage: candidateLimit
		});
		for (const row of fts.repos as RepoFtsRow[]) {
			lexicalById.set(row.id, {
				lexicalScore: bm25ToSimilarity(row.fts_rank),
				snippet: row.fts_snippet,
				row
			});
		}
	}

	let idSet = new Set<number>([
		...semanticScoreById.keys(),
		...lexicalById.keys()
	]);

	// ALWAYS apply buildRepoFilters eligibility — with or without user filters —
	// so deleted / pending-deletion repos cannot leak through TurboVec hits.
	idSet = new Set(filterRepoIdsByQuery([...idSet], opts));

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
		for (const id of [...idSet]) {
			if (!semanticScoreById.has(id)) idSet.delete(id);
		}
	}

	const candidates = [...idSet]
		.map((id) => {
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
		})
		.filter((c) => c.row);

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
			fts_rank: similarityToBm25(base.lexicalScore),
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
		semanticAvailable,
		pagination: 'candidate-window',
		retrievalPath: allowlist
			? 'allowlist'
			: useCandidatePostFilter
				? 'post-filter'
				: 'unfiltered'
	};
}
