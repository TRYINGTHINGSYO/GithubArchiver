/**
 * Shared loader + multi-stage ranked retrieval for GithubArchiver memory.
 *
 * Pipeline:
 *   Stage 1 — Candidate retrieval (top K by concept)
 *   Stage 2 — Typed graph expansion (1–2 hops from candidates)
 *   Stage 3 — Re-rank (full score model)
 *   Assemble — fill token budget with minimal context
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ENTRY_TYPES = [
	'decision',
	'incident',
	'migration',
	'feature',
	'bugfix',
	'performance',
	'refactor',
	'test',
	'release',
	'technical-debt',
	'research'
] as const;

export type EntryType = (typeof ENTRY_TYPES)[number];
export type EntryStatus = 'merged' | 'open' | 'verified' | 'superseded' | 'open-debt';
export type Confidence = 'confirmed' | 'hypothesis' | 'deprecated';
export type Durability = 'transient' | 'temporary' | 'release' | 'permanent';

export const RELATION_TYPES = [
	'caused-by',
	'implemented-by',
	'supersedes',
	'references',
	'validates',
	'related'
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

const TYPE_ALIASES: Record<string, EntryType> = {
	architecture: 'decision',
	debt: 'technical-debt',
	pr: 'feature'
};

const CONFIDENCE_VALUES = new Set<Confidence>(['confirmed', 'hypothesis', 'deprecated']);
const DURABILITY_VALUES = new Set<Durability>(['transient', 'temporary', 'release', 'permanent']);

/** Prefer following these edges when expanding for root-cause style queries. */
const EDGE_EXPAND_WEIGHT: Record<RelationType, number> = {
	'caused-by': 1.0,
	'implemented-by': 0.9,
	supersedes: 0.85,
	references: 0.7,
	validates: 0.65,
	related: 0.5
};

export interface Relationship {
	type: RelationType;
	id: string;
}

export interface MemoryEntry {
	stem: string;
	id: string;
	date: string;
	pr: number | null;
	commit: string | null;
	area: string[];
	type: EntryType;
	status: EntryStatus;
	confidence: Confidence;
	durability: Durability;
	supersedes: string | null;
	related: string[];
	relationships: Relationship[];
	title: string;
	migration: number | null;
	relPath: string;
	summary: string;
	body: string;
}

export interface MemoryIndexFile {
	generated: true;
	generatedAt: string;
	project: 'githubarchiver';
	entries: Array<{
		id: string;
		type: EntryType;
		status: EntryStatus;
		confidence: Confidence;
		durability: Durability;
		date: string;
		pr: number | null;
		commit: string | null;
		migration: number | null;
		area: string[];
		related: string[];
		relationships: Relationship[];
		supersedes: string | null;
		title: string;
		path: string;
		summary: string;
	}>;
}

export interface ScoreBreakdown {
	concept: number;
	edge: number;
	confidence: number;
	recency: number;
	durability: number;
	status: number;
	total: number;
}

export interface QueryHit {
	entry: MemoryEntry;
	score: number;
	breakdown: ScoreBreakdown;
	via: string;
	depth: number;
	edgeType?: RelationType;
}

export function defaultMemoryRoot(): string {
	return resolve(
		process.env.AI_MEMORY_ENTRIES ?? 'docs/ai-memory/seed/02 - Projects/GithubArchiver'
	);
}

function parseScalar(raw: string): string | number | null {
	const v = raw.trim();
	if (v === 'null' || v === '~' || v === '') return null;
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
		return v.slice(1, -1);
	}
	if (/^-?\d+$/.test(v)) return Number(v);
	return v;
}

/**
 * Minimal YAML frontmatter parser supporting:
 * - scalars
 * - lists of scalars
 * - lists of maps (for relationships)
 */
export function parseFrontmatter(text: string): { fm: Record<string, unknown>; body: string } {
	if (!text.startsWith('---\n')) throw new Error('missing frontmatter open');
	const end = text.indexOf('\n---\n', 4);
	if (end < 0) throw new Error('missing frontmatter close');
	const block = text.slice(4, end);
	const body = text.slice(end + 5).trim();
	const out: Record<string, unknown> = {};
	let listKey: string | null = null;
	let currentObj: Record<string, unknown> | null = null;

	const flushObj = () => {
		if (!listKey || !currentObj) return;
		const arr = (out[listKey] as unknown[]) ?? [];
		arr.push(currentObj);
		out[listKey] = arr;
		currentObj = null;
	};

	for (const line of block.split('\n')) {
		if (/^\s+-\s+/.test(line) && listKey) {
			const rest = line.replace(/^\s+-\s+/, '');
			const objStart = rest.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
			if (objStart && (objStart[1] === 'type' || objStart[1] === 'id')) {
				flushObj();
				currentObj = { [objStart[1]]: parseScalar(objStart[2]) };
				continue;
			}
			flushObj();
			const arr = (out[listKey] as unknown[]) ?? [];
			arr.push(parseScalar(rest));
			out[listKey] = arr;
			continue;
		}

		if (currentObj && /^\s{2,}([A-Za-z0-9_]+):\s*(.*)$/.test(line)) {
			const m = line.match(/^\s{2,}([A-Za-z0-9_]+):\s*(.*)$/)!;
			currentObj[m[1]] = parseScalar(m[2]);
			continue;
		}

		flushObj();
		listKey = null;
		const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
		if (!m) continue;
		const [, key, rest] = m;
		if (rest === '' || rest === '|' || rest === '>') {
			listKey = key;
			out[key] = out[key] ?? [];
			continue;
		}
		out[key] = parseScalar(rest);
	}
	flushObj();
	return { fm: out, body };
}

function firstParagraph(body: string): string {
	const lines = body
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('```'));
	return lines[0] ?? '';
}

function normalizeType(raw: string): EntryType {
	const aliased = TYPE_ALIASES[raw] ?? raw;
	if (!(ENTRY_TYPES as readonly string[]).includes(aliased)) {
		throw new Error(`invalid type: ${raw}`);
	}
	return aliased as EntryType;
}

function inferConfidence(fm: Record<string, unknown>, status: EntryStatus): Confidence {
	if (fm.confidence != null) {
		const c = String(fm.confidence) as Confidence;
		if (!CONFIDENCE_VALUES.has(c)) throw new Error(`invalid confidence: ${fm.confidence}`);
		return c;
	}
	if (status === 'superseded') return 'deprecated';
	if (status === 'open' && String(fm.type) === 'research') return 'hypothesis';
	return 'confirmed';
}

function inferDurability(fm: Record<string, unknown>, type: EntryType): Durability {
	if (fm.durability != null) {
		const d = String(fm.durability) as Durability;
		if (!DURABILITY_VALUES.has(d)) throw new Error(`invalid durability: ${fm.durability}`);
		return d;
	}
	switch (type) {
		case 'decision':
		case 'incident':
		case 'migration':
			return 'permanent';
		case 'technical-debt':
			return 'temporary';
		case 'research':
			return 'transient';
		case 'release':
			return 'release';
		default:
			return 'release';
	}
}

function normalizeRelationships(fm: Record<string, unknown>): {
	relationships: Relationship[];
	related: string[];
	supersedes: string | null;
} {
	const relationships: Relationship[] = [];
	const relatedIds = new Set<string>();

	const rawRels = Array.isArray(fm.relationships) ? fm.relationships : [];
	for (const item of rawRels) {
		if (typeof item === 'string') {
			const m = item.match(/^([a-z-]+):(.+)$/);
			if (m && (RELATION_TYPES as readonly string[]).includes(m[1])) {
				relationships.push({ type: m[1] as RelationType, id: m[2].trim() });
				relatedIds.add(m[2].trim());
			} else {
				relationships.push({ type: 'related', id: item });
				relatedIds.add(item);
			}
			continue;
		}
		if (item && typeof item === 'object') {
			const obj = item as Record<string, unknown>;
			const type = String(obj.type ?? 'related') as RelationType;
			const id = String(obj.id ?? '');
			if (!id) continue;
			if (!(RELATION_TYPES as readonly string[]).includes(type)) {
				throw new Error(`invalid relationship type: ${type}`);
			}
			relationships.push({ type, id });
			relatedIds.add(id);
		}
	}

	const legacyRelated = Array.isArray(fm.related) ? fm.related.map(String) : [];
	for (const id of legacyRelated) {
		if (!relatedIds.has(id)) {
			relationships.push({ type: 'related', id });
			relatedIds.add(id);
		}
	}

	let supersedes = fm.supersedes == null ? null : String(fm.supersedes);
	if (supersedes) {
		if (!relationships.some((r) => r.type === 'supersedes' && r.id === supersedes)) {
			relationships.push({ type: 'supersedes', id: supersedes });
			relatedIds.add(supersedes);
		}
	} else {
		const edge = relationships.find((r) => r.type === 'supersedes');
		if (edge) supersedes = edge.id;
	}

	return { relationships, related: [...relatedIds], supersedes };
}

export function loadMemoryEntries(root: string = defaultMemoryRoot()): MemoryEntry[] {
	const entriesDir = join(root, 'entries');
	const files = readdirSync(entriesDir)
		.filter((f) => f.endsWith('.md') && f !== 'SCHEMA.md')
		.sort();
	const entries: MemoryEntry[] = [];
	const seenIds = new Set<string>();

	for (const file of files) {
		const text = readFileSync(join(entriesDir, file), 'utf8');
		const { fm, body } = parseFrontmatter(text);
		const stem = file.replace(/\.md$/, '');
		const type = normalizeType(String(fm.type));
		const status = String(fm.status) as EntryStatus;
		const area = Array.isArray(fm.area) ? fm.area.map(String) : [];
		if (fm.id == null || String(fm.id).trim() === '') {
			throw new Error(`${file}: stable id: is required`);
		}
		const id = String(fm.id);
		if (seenIds.has(id)) throw new Error(`duplicate memory id: ${id}`);
		seenIds.add(id);
		const title = String(fm.title ?? '');
		if (!title) throw new Error(`${file}: title required`);
		const date = String(fm.date);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${file}: date must be YYYY-MM-DD`);
		const { relationships, related, supersedes } = normalizeRelationships(fm);

		entries.push({
			stem,
			id,
			date,
			pr: fm.pr == null ? null : Number(fm.pr),
			commit: fm.commit == null ? null : String(fm.commit),
			area,
			type,
			status,
			confidence: inferConfidence(fm, status),
			durability: inferDurability(fm, type),
			supersedes,
			related,
			relationships,
			title,
			migration: fm.migration == null ? null : Number(fm.migration),
			relPath: `entries/${file}`,
			summary: firstParagraph(body),
			body
		});
	}

	return entries.sort((a, b) => {
		if (a.date !== b.date) return a.date < b.date ? 1 : -1;
		return (b.pr ?? -1) - (a.pr ?? -1);
	});
}

export function buildAliasIndex(entries: MemoryEntry[]): Map<string, MemoryEntry> {
	const map = new Map<string, MemoryEntry>();
	for (const e of entries) {
		map.set(e.id, e);
		map.set(e.stem, e);
		if (e.pr != null) map.set(`pr-${e.pr}`, e);
		if (e.migration != null) {
			map.set(`migration-${e.migration}`, e);
			map.set(`migration-${String(e.migration).padStart(3, '0')}`, e);
		}
	}
	const oldestFirst = [...entries].sort((a, b) => {
		if (a.date !== b.date) return a.date < b.date ? -1 : 1;
		return (a.pr ?? 0) - (b.pr ?? 0);
	});
	for (const e of oldestFirst) {
		for (const a of e.area) {
			if (!map.has(a)) map.set(a, e);
		}
	}
	return map;
}

export function resolveRef(
	ref: string,
	aliases: Map<string, MemoryEntry>
): MemoryEntry | undefined {
	return aliases.get(ref);
}

export function toMemoryIndex(entries: MemoryEntry[], generatedAt = new Date().toISOString()): MemoryIndexFile {
	return {
		generated: true,
		generatedAt,
		project: 'githubarchiver',
		entries: entries.map((e) => ({
			id: e.id,
			type: e.type,
			status: e.status,
			confidence: e.confidence,
			durability: e.durability,
			date: e.date,
			pr: e.pr,
			commit: e.commit,
			migration: e.migration,
			area: e.area,
			related: e.related,
			relationships: e.relationships,
			supersedes: e.supersedes,
			title: e.title,
			path: e.relPath,
			summary: e.summary
		}))
	};
}

export function tokenizeQuery(q: string): string[] {
	return q
		.toLowerCase()
		.split(/[^a-z0-9/#._-]+/)
		.map((t) => t.trim())
		.filter((t) => t.length >= 2);
}

/** Rough token estimate for budget assembly (~4 chars/token). */
export function estimateTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

export function scoreConceptMatch(entry: MemoryEntry, tokens: string[], queryRaw: string): number {
	if (tokens.length === 0 && !queryRaw.trim()) return 0;
	let raw = 0;
	const id = entry.id.toLowerCase();
	const title = entry.title.toLowerCase();
	const areas = entry.area.map((a) => a.toLowerCase());
	const hay = `${entry.summary}\n${entry.body}`.toLowerCase();
	const q = queryRaw.trim().toLowerCase();

	if (q && (id === q || id.includes(q))) raw += 40;
	if (q && title.includes(q)) raw += 28;

	for (const t of tokens) {
		if (id === t) raw += 36;
		else if (id.includes(t)) raw += 22;
		if (title.includes(t)) raw += 16;
		if (areas.some((a) => a === t)) raw += 18;
		else if (areas.some((a) => a.includes(t) || t.includes(a))) raw += 12;
		if (entry.type === t || entry.type.includes(t)) raw += 8;
		if (t.startsWith('pr-') && entry.pr != null && `pr-${entry.pr}` === t) raw += 30;
		if (t.startsWith('migration-') && entry.migration != null) {
			const n = Number(t.replace(/^migration-0*/, '') || t.replace('migration-', ''));
			if (n === entry.migration) raw += 30;
		}
		if (hay.includes(t)) raw += 4;
	}

	return Math.min(40, raw);
}

export function scoreEdgeDistance(depth: number): number {
	if (depth <= 0) return 25;
	if (depth === 1) return 14;
	if (depth === 2) return 7;
	if (depth === 3) return 3;
	return 1;
}

export function scoreConfidence(confidence: Confidence): number {
	switch (confidence) {
		case 'confirmed':
			return 15;
		case 'hypothesis':
			return 6;
		case 'deprecated':
			return 0;
	}
}

export function scoreRecency(entry: MemoryEntry, newestMs: number): number {
	const ageDays = Math.max(0, (newestMs - Date.parse(entry.date)) / 86_400_000);
	if (ageDays <= 2) return 10;
	if (ageDays <= 14) return 8;
	if (ageDays <= 45) return 5;
	if (ageDays <= 120) return 3;
	return 1;
}

/** Durability score component from explicit metadata (0–5). */
export function scoreDurabilityMeta(durability: Durability): number {
	switch (durability) {
		case 'permanent':
			return 5;
		case 'release':
			return 3;
		case 'temporary':
			return 2;
		case 'transient':
			return 1;
	}
}

export function scoreStatusBoost(status: EntryStatus): number {
	switch (status) {
		case 'open':
		case 'open-debt':
			return 5;
		case 'verified':
			return 3;
		case 'merged':
			return 1;
		case 'superseded':
			return 0;
	}
}

export function composeScore(parts: Omit<ScoreBreakdown, 'total'>): ScoreBreakdown {
	const total =
		parts.concept + parts.edge + parts.confidence + parts.recency + parts.durability + parts.status;
	return { ...parts, total };
}

function outgoingEdges(entry: MemoryEntry): Relationship[] {
	return entry.relationships;
}

function incomingEdges(
	entry: MemoryEntry,
	entries: MemoryEntry[]
): Array<Relationship & { from: string }> {
	const out: Array<Relationship & { from: string }> = [];
	for (const other of entries) {
		for (const rel of other.relationships) {
			if (
				rel.id === entry.id ||
				(entry.pr != null && rel.id === `pr-${entry.pr}`) ||
				(entry.migration != null &&
					(rel.id === `migration-${entry.migration}` ||
						rel.id === `migration-${String(entry.migration).padStart(3, '0')}`))
			) {
				out.push({ ...rel, from: other.id });
			}
		}
	}
	return out;
}

export interface QueryOptions {
	depth?: number;
	/** Stage 1 candidate pool size */
	candidates?: number;
	/** Final ranked hits if no token budget */
	limit?: number;
	includeHypotheses?: boolean;
	includeDeprecated?: boolean;
	/** Prefer following these edge types during expansion */
	follow?: RelationType[];
	/** Approximate token budget for assembled context (chars/4) */
	budget?: number;
}

export interface QueryResult {
	hits: QueryHit[];
	candidates: QueryHit[];
	assembled: QueryHit[];
	tokensUsed: number;
	budget: number | null;
	stages: {
		candidates: number;
		expanded: number;
		ranked: number;
		assembled: number;
	};
}

/**
 * Multi-stage retrieval:
 * 1) Candidate retrieval by concept
 * 2) Typed graph expansion from top candidates
 * 3) Full re-rank
 * 4) Optional token-budget assembly
 */
export function queryMemory(
	entries: MemoryEntry[],
	query: string,
	opts: QueryOptions = {}
): QueryHit[] {
	return queryMemoryDetailed(entries, query, opts).assembled;
}

export function queryMemoryDetailed(
	entries: MemoryEntry[],
	query: string,
	opts: QueryOptions = {}
): QueryResult {
	const depth = opts.depth ?? 2;
	const candidateN = opts.candidates ?? 20;
	const limit = opts.limit ?? 8;
	const includeHypotheses = opts.includeHypotheses ?? false;
	const includeDeprecated = opts.includeDeprecated ?? false;
	const follow = new Set(opts.follow ?? RELATION_TYPES);
	const budget = opts.budget ?? null;
	const aliases = buildAliasIndex(entries);
	const tokens = tokenizeQuery(query);
	const newestMs = Math.max(...entries.map((e) => Date.parse(e.date)), Date.now());

	const allowed = (e: MemoryEntry) => {
		if (!includeDeprecated && e.confidence === 'deprecated') return false;
		if (!includeHypotheses && e.confidence === 'hypothesis') return false;
		return true;
	};

	const direct = aliases.get(query.trim()) ?? aliases.get(query.trim().toLowerCase());

	// ----- Stage 1: candidate retrieval -----
	const stage1: QueryHit[] = [];
	for (const e of entries) {
		if (!allowed(e)) continue;
		let concept = scoreConceptMatch(e, tokens, query);
		if (direct?.id === e.id) concept = Math.max(concept, 40);
		if (concept <= 0) continue;
		const breakdown = composeScore({
			concept,
			edge: scoreEdgeDistance(0),
			confidence: scoreConfidence(e.confidence),
			recency: scoreRecency(e, newestMs),
			durability: scoreDurabilityMeta(e.durability),
			status: scoreStatusBoost(e.status)
		});
		stage1.push({
			entry: e,
			score: breakdown.total,
			breakdown,
			via: 'stage1:match',
			depth: 0
		});
	}
	stage1.sort((a, b) => b.breakdown.concept - a.breakdown.concept || b.score - a.score);
	const candidates = stage1.slice(0, candidateN);

	// ----- Stage 2: typed graph expansion -----
	type Reach = { depth: number; via: string; edgeType?: RelationType; seedConcept: number };
	const reach = new Map<string, Reach>();
	const queue: Array<{ id: string; depth: number; via: string; edgeType?: RelationType; seedConcept: number }> =
		[];

	for (const c of candidates) {
		reach.set(c.entry.id, {
			depth: 0,
			via: 'stage1:match',
			seedConcept: c.breakdown.concept
		});
		queue.push({
			id: c.entry.id,
			depth: 0,
			via: 'stage1:match',
			seedConcept: c.breakdown.concept
		});
	}

	while (queue.length) {
		const cur = queue.shift()!;
		if (cur.depth >= depth) continue;
		const entry = aliases.get(cur.id);
		if (!entry) continue;

		const outs = outgoingEdges(entry)
			.filter((r) => follow.has(r.type))
			.sort((a, b) => EDGE_EXPAND_WEIGHT[b.type] - EDGE_EXPAND_WEIGHT[a.type]);

		for (const rel of outs) {
			const next = resolveRef(rel.id, aliases);
			if (!next || !allowed(next)) continue;
			const nextDepth = cur.depth + 1;
			const prev = reach.get(next.id);
			if (prev && prev.depth <= nextDepth) continue;
			reach.set(next.id, {
				depth: nextDepth,
				via: `${rel.type}:${entry.id}`,
				edgeType: rel.type,
				seedConcept: cur.seedConcept
			});
			queue.push({
				id: next.id,
				depth: nextDepth,
				via: `${rel.type}:${entry.id}`,
				edgeType: rel.type,
				seedConcept: cur.seedConcept
			});
		}

		// Reverse edges (who points here) — useful for implemented-by / validates.
		for (const rel of incomingEdges(entry, entries)) {
			if (!follow.has(rel.type)) continue;
			const next = aliases.get(rel.from);
			if (!next || !allowed(next)) continue;
			const nextDepth = cur.depth + 1;
			const prev = reach.get(next.id);
			if (prev && prev.depth <= nextDepth) continue;
			reach.set(next.id, {
				depth: nextDepth,
				via: `inv-${rel.type}:${entry.id}`,
				edgeType: rel.type,
				seedConcept: cur.seedConcept
			});
			queue.push({
				id: next.id,
				depth: nextDepth,
				via: `inv-${rel.type}:${entry.id}`,
				edgeType: rel.type,
				seedConcept: cur.seedConcept
			});
		}
	}

	// ----- Stage 3: re-rank -----
	const ranked: QueryHit[] = [];
	for (const [id, r] of reach) {
		const entry = aliases.get(id);
		if (!entry) continue;
		const intrinsic = scoreConceptMatch(entry, tokens, query);
		const concept =
			intrinsic > 0 ? intrinsic : Math.max(4, Math.min(16, r.seedConcept * 0.35 - r.depth * 2));
		const edgeBoost =
			r.edgeType && r.depth > 0 ? EDGE_EXPAND_WEIGHT[r.edgeType] * 2 : 0;
		const breakdown = composeScore({
			concept: Math.min(40, concept),
			edge: Math.min(25, scoreEdgeDistance(r.depth) + edgeBoost),
			confidence: scoreConfidence(entry.confidence),
			recency: scoreRecency(entry, newestMs),
			durability: scoreDurabilityMeta(entry.durability),
			status: scoreStatusBoost(entry.status)
		});
		ranked.push({
			entry,
			score: breakdown.total,
			breakdown,
			via: r.via,
			depth: r.depth,
			edgeType: r.edgeType
		});
	}
	ranked.sort((a, b) => b.score - a.score || (a.entry.date < b.entry.date ? 1 : -1));

	// ----- Assemble under token budget -----
	const pool = ranked.slice(0, Math.max(limit, budget ? 50 : limit));
	const assembled: QueryHit[] = [];
	let tokensUsed = 0;
	const headerTax = 40;

	if (budget != null && budget > 0) {
		tokensUsed = headerTax;
		for (const h of pool) {
			const chunk = formatHitChunk(h);
			const cost = estimateTokens(chunk);
			if (assembled.length > 0 && tokensUsed + cost > budget) break;
			assembled.push(h);
			tokensUsed += cost;
			if (assembled.length >= limit && tokensUsed >= budget * 0.9) break;
		}
	} else {
		assembled.push(...ranked.slice(0, limit));
		tokensUsed = estimateTokens(assembled.map(formatHitChunk).join('\n'));
	}

	return {
		hits: ranked,
		candidates,
		assembled,
		tokensUsed,
		budget,
		stages: {
			candidates: candidates.length,
			expanded: reach.size,
			ranked: ranked.length,
			assembled: assembled.length
		}
	};
}

export function formatHitChunk(h: QueryHit): string {
	const e = h.entry;
	const parts = [
		`## ${e.type}: ${e.title}`,
		`id: ${e.id}`,
		`confidence: ${e.confidence}`,
		`durability: ${e.durability}`,
		e.summary,
		e.relationships.map((r) => `${r.type}:${r.id}`).join(', ')
	];
	return parts.filter(Boolean).join('\n');
}

export function clusterHits(hits: QueryHit[]): Map<string, QueryHit[]> {
	const order = [
		'decision',
		'incident',
		'migration',
		'technical-debt',
		'feature',
		'bugfix',
		'performance',
		'refactor',
		'test',
		'release',
		'research'
	];
	const map = new Map<string, QueryHit[]>();
	for (const key of order) map.set(key, []);
	for (const h of hits) {
		const list = map.get(h.entry.type) ?? [];
		list.push(h);
		map.set(h.entry.type, list);
	}
	for (const [k, v] of [...map.entries()]) {
		if (v.length === 0) map.delete(k);
	}
	return map;
}

/** Follow caused-by edges to surface root-cause entries. */
export function rootCauses(entry: MemoryEntry, aliases: Map<string, MemoryEntry>): MemoryEntry[] {
	return entry.relationships
		.filter((r) => r.type === 'caused-by')
		.map((r) => resolveRef(r.id, aliases))
		.filter((e): e is MemoryEntry => Boolean(e));
}
