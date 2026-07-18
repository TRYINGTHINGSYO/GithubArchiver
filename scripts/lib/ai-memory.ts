/**
 * Shared loader + retrieval scoring for GithubArchiver structured memory.
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

const TYPE_ALIASES: Record<string, EntryType> = {
	architecture: 'decision',
	debt: 'technical-debt',
	pr: 'feature'
};

const CONFIDENCE_VALUES = new Set<Confidence>(['confirmed', 'hypothesis', 'deprecated']);

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
	supersedes: string | null;
	related: string[];
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
		date: string;
		pr: number | null;
		commit: string | null;
		migration: number | null;
		area: string[];
		related: string[];
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

export function parseFrontmatter(text: string): { fm: Record<string, unknown>; body: string } {
	if (!text.startsWith('---\n')) throw new Error('missing frontmatter open');
	const end = text.indexOf('\n---\n', 4);
	if (end < 0) throw new Error('missing frontmatter close');
	const block = text.slice(4, end);
	const body = text.slice(end + 5).trim();
	const out: Record<string, unknown> = {};
	let listKey: string | null = null;
	for (const line of block.split('\n')) {
		if (/^\s+-\s+/.test(line) && listKey) {
			const item = parseScalar(line.replace(/^\s+-\s+/, ''));
			const arr = (out[listKey] as unknown[]) ?? [];
			arr.push(item);
			out[listKey] = arr;
			continue;
		}
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
		const related = Array.isArray(fm.related) ? fm.related.map(String) : [];
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
			supersedes: fm.supersedes == null ? null : String(fm.supersedes),
			related,
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
			date: e.date,
			pr: e.pr,
			commit: e.commit,
			migration: e.migration,
			area: e.area,
			related: e.related,
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

/** Concept match component: 0–40 */
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

/** Edge distance component: depth 0 → 25, then decays */
export function scoreEdgeDistance(depth: number): number {
	if (depth <= 0) return 25;
	if (depth === 1) return 14;
	if (depth === 2) return 7;
	if (depth === 3) return 3;
	return 1;
}

/** Confidence component: 0–15 */
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

/** Recency component: 0–10 relative to newest entry date */
export function scoreRecency(entry: MemoryEntry, newestMs: number): number {
	const ageDays = Math.max(0, (newestMs - Date.parse(entry.date)) / 86_400_000);
	if (ageDays <= 2) return 10;
	if (ageDays <= 14) return 8;
	if (ageDays <= 45) return 5;
	if (ageDays <= 120) return 3;
	return 1;
}

/** Durability component: 0–5 — enduring knowledge ranks above transient work */
export function scoreDurability(type: EntryType): number {
	switch (type) {
		case 'decision':
			return 5;
		case 'incident':
		case 'migration':
			return 4;
		case 'technical-debt':
			return 3;
		case 'feature':
		case 'bugfix':
		case 'performance':
			return 2;
		case 'refactor':
		case 'test':
		case 'release':
			return 1;
		case 'research':
			return 1;
	}
}

/** Current-status boost: 0–5 */
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

function neighborsOf(entry: MemoryEntry, entries: MemoryEntry[], aliases: Map<string, MemoryEntry>): MemoryEntry[] {
	const ids = new Set<string>();
	const out: MemoryEntry[] = [];
	const push = (ref: string) => {
		const hit = resolveRef(ref, aliases);
		if (hit && !ids.has(hit.id)) {
			ids.add(hit.id);
			out.push(hit);
		}
	};

	for (const r of entry.related) push(r);
	if (entry.supersedes) push(entry.supersedes);

	for (const other of entries) {
		if (other.id === entry.id) continue;
		const pointsHere =
			other.related.includes(entry.id) ||
			other.supersedes === entry.id ||
			(entry.pr != null && other.related.includes(`pr-${entry.pr}`)) ||
			(entry.migration != null &&
				(other.related.includes(`migration-${entry.migration}`) ||
					other.related.includes(`migration-${String(entry.migration).padStart(3, '0')}`)));
		if (pointsHere) push(other.id);
	}
	return out;
}

export interface QueryOptions {
	depth?: number;
	limit?: number;
	/** Default false — confirmed only */
	includeHypotheses?: boolean;
	/** Default false */
	includeDeprecated?: boolean;
}

/**
 * Ranked retrieval:
 * score = concept + edge distance + confidence + recency + durability + status boost
 *
 * Default returns confirmed knowledge only.
 */
export function queryMemory(
	entries: MemoryEntry[],
	query: string,
	opts: QueryOptions = {}
): QueryHit[] {
	const depth = opts.depth ?? 2;
	const limit = opts.limit ?? 8;
	const includeHypotheses = opts.includeHypotheses ?? false;
	const includeDeprecated = opts.includeDeprecated ?? false;
	const aliases = buildAliasIndex(entries);
	const tokens = tokenizeQuery(query);
	const newestMs = Math.max(...entries.map((e) => Date.parse(e.date)), Date.now());

	const allowed = (e: MemoryEntry) => {
		if (!includeDeprecated && e.confidence === 'deprecated') return false;
		if (!includeHypotheses && e.confidence === 'hypothesis') return false;
		return true;
	};

	const direct = aliases.get(query.trim()) ?? aliases.get(query.trim().toLowerCase());
	const conceptById = new Map<string, number>();
	for (const e of entries) {
		if (!allowed(e)) continue;
		let concept = scoreConceptMatch(e, tokens, query);
		if (direct?.id === e.id) concept = Math.max(concept, 40);
		if (concept > 0) conceptById.set(e.id, concept);
	}

	// BFS from concept seeds — track minimum graph distance + provenance.
	type Reach = { depth: number; via: string };
	const reach = new Map<string, Reach>();
	const queue: Array<{ id: string; depth: number; via: string }> = [];

	for (const id of conceptById.keys()) {
		reach.set(id, { depth: 0, via: 'match' });
		queue.push({ id, depth: 0, via: 'match' });
	}

	while (queue.length) {
		const cur = queue.shift()!;
		if (cur.depth >= depth) continue;
		const entry = aliases.get(cur.id);
		if (!entry) continue;
		for (const next of neighborsOf(entry, entries, aliases)) {
			if (!allowed(next)) continue;
			const nextDepth = cur.depth + 1;
			const prev = reach.get(next.id);
			if (prev && prev.depth <= nextDepth) continue;
			reach.set(next.id, { depth: nextDepth, via: `related:${entry.id}` });
			queue.push({ id: next.id, depth: nextDepth, via: `related:${entry.id}` });
		}
	}

	const hits: QueryHit[] = [];
	for (const [id, r] of reach) {
		const entry = aliases.get(id);
		if (!entry) continue;
		// Intrinsic concept for seeds; small residual for edge-only nodes so they can still rank.
		const concept = conceptById.get(id) ?? Math.max(4, 12 - r.depth * 3);
		const breakdown = composeScore({
			concept: Math.min(40, concept),
			edge: scoreEdgeDistance(r.depth),
			confidence: scoreConfidence(entry.confidence),
			recency: scoreRecency(entry, newestMs),
			durability: scoreDurability(entry.type),
			status: scoreStatusBoost(entry.status)
		});
		hits.push({
			entry,
			score: breakdown.total,
			breakdown,
			via: r.via,
			depth: r.depth
		});
	}

	return hits.sort((a, b) => b.score - a.score || (a.entry.date < b.entry.date ? 1 : -1)).slice(0, limit);
}

/** Group hits for human/agent presentation around concept types. */
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
