/**
 * Shared loader for GithubArchiver structured memory entries.
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

export function scoreEntry(entry: MemoryEntry, tokens: string[]): number {
	if (tokens.length === 0) return 0;
	let score = 0;
	const id = entry.id.toLowerCase();
	const title = entry.title.toLowerCase();
	const areas = entry.area.map((a) => a.toLowerCase());
	const hay = `${entry.summary}\n${entry.body}`.toLowerCase();

	for (const t of tokens) {
		if (id === t || id.includes(t)) score += 12;
		if (title.includes(t)) score += 8;
		if (areas.some((a) => a === t || a.includes(t))) score += 6;
		if (entry.type.includes(t)) score += 4;
		if (t.startsWith('pr-') && entry.pr != null && `pr-${entry.pr}` === t) score += 14;
		if (t.startsWith('migration-') && entry.migration != null) {
			const n = Number(t.replace('migration-', ''));
			if (n === entry.migration) score += 14;
		}
		if (hay.includes(t)) score += 2;
	}

	if (entry.confidence === 'deprecated') score *= 0.35;
	else if (entry.confidence === 'hypothesis') score *= 0.75;
	if (entry.status === 'open' || entry.status === 'open-debt') score += 1;
	return score;
}

export interface QueryHit {
	entry: MemoryEntry;
	score: number;
	via: string;
	depth: number;
}

/**
 * Score seed matches, then BFS outward through related/supersedes edges.
 */
export function queryMemory(
	entries: MemoryEntry[],
	query: string,
	opts: { depth?: number; limit?: number; includeDeprecated?: boolean } = {}
): QueryHit[] {
	const depth = opts.depth ?? 2;
	const limit = opts.limit ?? 12;
	const includeDeprecated = opts.includeDeprecated ?? false;
	const aliases = buildAliasIndex(entries);
	const tokens = tokenizeQuery(query);

	const seedScores = new Map<string, number>();
	for (const e of entries) {
		const s = scoreEntry(e, tokens);
		if (s > 0) seedScores.set(e.id, s);
	}

	// Exact id / alias hit
	const direct = aliases.get(query.trim()) ?? aliases.get(query.trim().toLowerCase());
	if (direct) seedScores.set(direct.id, Math.max(seedScores.get(direct.id) ?? 0, 20));

	const best = new Map<string, QueryHit>();
	const queue: Array<{ id: string; score: number; via: string; depth: number }> = [];

	for (const [id, score] of seedScores) {
		queue.push({ id, score, via: 'match', depth: 0 });
	}
	queue.sort((a, b) => b.score - a.score);

	while (queue.length) {
		const cur = queue.shift()!;
		const entry = aliases.get(cur.id);
		if (!entry) continue;
		if (!includeDeprecated && entry.confidence === 'deprecated') continue;

		const prev = best.get(entry.id);
		if (prev && prev.score >= cur.score) continue;
		best.set(entry.id, {
			entry,
			score: cur.score,
			via: cur.via,
			depth: cur.depth
		});

		if (cur.depth >= depth) continue;
		const edgeScore = cur.score * 0.55;
		const neighbors = [...entry.related];
		if (entry.supersedes) neighbors.push(entry.supersedes);
		// reverse edges
		for (const other of entries) {
			if (other.related.includes(entry.id) || other.related.includes(`pr-${entry.pr}`) || other.supersedes === entry.id) {
				neighbors.push(other.id);
			}
			if (entry.pr != null && other.related.includes(`pr-${entry.pr}`)) neighbors.push(other.id);
			if (entry.migration != null) {
				const m = `migration-${String(entry.migration).padStart(3, '0')}`;
				if (other.related.includes(m) || other.related.includes(`migration-${entry.migration}`)) {
					neighbors.push(other.id);
				}
			}
		}

		for (const ref of neighbors) {
			const next = resolveRef(ref, aliases);
			if (!next) continue;
			if (!includeDeprecated && next.confidence === 'deprecated') continue;
			const existing = best.get(next.id);
			const nextScore = edgeScore;
			if (existing && existing.score >= nextScore) continue;
			queue.push({
				id: next.id,
				score: nextScore,
				via: `related:${entry.id}`,
				depth: cur.depth + 1
			});
		}
	}

	return [...best.values()]
		.sort((a, b) => b.score - a.score || (a.entry.date < b.entry.date ? 1 : -1))
		.slice(0, limit);
}
