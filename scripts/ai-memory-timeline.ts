#!/usr/bin/env tsx
/**
 * Regenerate GithubArchiver memory views from append-only structured entries.
 *
 * Artifacts:
 *   - Timeline.md          chronological event log view
 *   - Current Status.md    living summary (derived)
 *   - Project Digest.md    single AI-priming document
 *   - Knowledge Graph.md   related-id link map
 *   - indexes/<type>.md    per-type filters
 *   - PR Timeline.md, Production Incidents.md, Migrations.md, Open Technical Debt.md
 *
 * Usage:
 *   npm run memory:timeline
 *   npm run memory:timeline:check
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(
	process.env.AI_MEMORY_ENTRIES ?? 'docs/ai-memory/seed/02 - Projects/GithubArchiver'
);
const ENTRIES_DIR = join(ROOT, 'entries');
const INDEXES_DIR = join(ROOT, 'indexes');
const CHECK = process.argv.includes('--check');

const ENTRY_TYPES = [
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

type EntryType = (typeof ENTRY_TYPES)[number];
type EntryStatus = 'merged' | 'open' | 'verified' | 'superseded' | 'open-debt';

/** Accept legacy type names from PR #8 entries. */
const TYPE_ALIASES: Record<string, EntryType> = {
	architecture: 'decision',
	debt: 'technical-debt',
	pr: 'feature'
};

interface Entry {
	stem: string;
	id: string;
	date: string;
	pr: number | null;
	commit: string | null;
	area: string[];
	type: EntryType;
	status: EntryStatus;
	supersedes: string | null;
	related: string[];
	title: string;
	migration: number | null;
	relPath: string;
	summary: string;
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

function parseFrontmatter(text: string): { fm: Record<string, unknown>; body: string } {
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

function loadEntries(): Entry[] {
	const files = readdirSync(ENTRIES_DIR)
		.filter((f) => f.endsWith('.md') && f !== 'SCHEMA.md')
		.sort();
	const entries: Entry[] = [];
	for (const file of files) {
		const text = readFileSync(join(ENTRIES_DIR, file), 'utf8');
		const { fm, body } = parseFrontmatter(text);
		const stem = file.replace(/\.md$/, '');
		const type = normalizeType(String(fm.type));
		const status = String(fm.status) as EntryStatus;
		const area = Array.isArray(fm.area) ? fm.area.map(String) : [];
		const related = Array.isArray(fm.related) ? fm.related.map(String) : [];
		const id = fm.id == null ? stem : String(fm.id);
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
			supersedes: fm.supersedes == null ? null : String(fm.supersedes),
			related,
			title,
			migration: fm.migration == null ? null : Number(fm.migration),
			relPath: `entries/${file}`,
			summary: firstParagraph(body)
		});
	}
	return entries.sort((a, b) => {
		if (a.date !== b.date) return a.date < b.date ? 1 : -1;
		return (b.pr ?? -1) - (a.pr ?? -1);
	});
}

function buildAliasIndex(entries: Entry[]): Map<string, Entry> {
	const map = new Map<string, Entry>();
	for (const e of entries) {
		map.set(e.id, e);
		map.set(e.stem, e);
		if (e.pr != null) map.set(`pr-${e.pr}`, e);
		if (e.migration != null) {
			map.set(`migration-${e.migration}`, e);
			map.set(`migration-${String(e.migration).padStart(3, '0')}`, e);
		}
	}
	// Concept tags from `area:` — oldest entry wins so later work doesn't steal the alias.
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

function linkRef(ref: string, aliases: Map<string, Entry>): string {
	const hit = aliases.get(ref);
	if (hit) return `[\`${ref}\`](${hit.relPath})`;
	return `\`${ref}\``;
}

function lineFor(e: Entry, aliases: Map<string, Entry>): string {
	const bits = [`**${e.date}**`, `\`${e.type}\``];
	if (e.pr != null) bits.push(`PR #${e.pr}`);
	if (e.commit) bits.push(`\`${e.commit}\``);
	if (e.migration != null) bits.push(`migration ${e.migration}`);
	bits.push(`\`${e.status}\``);
	if (e.area.length) bits.push(e.area.map((a) => `\`${a}\``).join(', '));
	let line = `- ${bits.join(' · ')} — [${e.title}](${e.relPath})`;
	if (e.related.length) {
		line += `\n  - related: ${e.related.map((r) => linkRef(r, aliases)).join(', ')}`;
	}
	return line;
}

function genBanner(): string {
	return '> Generated by `npm run memory:timeline` from append-only `entries/*.md`. Do not edit by hand.';
}

function renderTimeline(entries: Entry[], aliases: Map<string, Entry>): string {
	const byDate = new Map<string, Entry[]>();
	for (const e of entries) {
		const list = byDate.get(e.date) ?? [];
		list.push(e);
		byDate.set(e.date, list);
	}
	const dates = [...byDate.keys()].sort((a, b) => (a < b ? 1 : -1));
	const sections = dates.map((date) => {
		const items = byDate.get(date)!;
		return `## ${date}\n\n${items.map((e) => lineFor(e, aliases)).join('\n')}`;
	});

	return [
		'---',
		'status: active',
		'project: githubarchiver',
		'type: timeline',
		'generated: true',
		'---',
		'',
		'# GithubArchiver Timeline',
		'',
		genBanner(),
		'',
		'Chronological event log (newest first). Source of truth is `entries/`.',
		'',
		...sections,
		''
	].join('\n');
}

function renderCurrentStatus(entries: Entry[], aliases: Map<string, Entry>): string {
	const open = entries.filter((e) => e.status === 'open' || e.status === 'open-debt');
	const recent = entries.filter((e) => e.status === 'merged' || e.status === 'verified').slice(0, 8);
	const debt = entries.filter((e) => e.type === 'technical-debt' || e.status === 'open-debt');
	const incidentsOpen = entries.filter((e) => e.type === 'incident' && e.status === 'open');

	return [
		'---',
		'status: active',
		'project: githubarchiver',
		'type: status',
		'generated: true',
		'---',
		'',
		'# Current Status',
		'',
		genBanner(),
		'',
		'Living summary derived from the entry log. For AI priming prefer [[Project Digest]].',
		'',
		'## Current architecture',
		'',
		'- GH Archive primary discovery; Search is fallback only',
		'- Background daemon plans ingest / enrich / archive / search_gap',
		'- Status UI: Current activity → Progress → Discovery',
		'- Orphan reconciliation covers `job_runs` and `search_ingest_stats`',
		'',
		'## Open work',
		'',
		open.length ? open.map((e) => lineFor(e, aliases)).join('\n') : '_None._',
		'',
		'## Open technical debt',
		'',
		debt.length ? debt.map((e) => lineFor(e, aliases)).join('\n') : '_None._',
		'',
		'## Active incidents',
		'',
		incidentsOpen.length ? incidentsOpen.map((e) => lineFor(e, aliases)).join('\n') : '_None._',
		'',
		'## Recent merges / verified',
		'',
		recent.length ? recent.map((e) => lineFor(e, aliases)).join('\n') : '_None._',
		'',
		'## Next priorities',
		'',
		'1. Merge/deploy open Search-fallback active accuracy fix and verify production table.',
		'2. Land memory system PRs; copy seed vault to `C:\\AI-Memory`.',
		'3. Confirm Railway `GITHUB_TOKEN` is real and quota-healthy.',
		''
	].join('\n');
}

function renderDigest(entries: Entry[], aliases: Map<string, Entry>): string {
	const principles = readOptional('Decisions.md');
	const architecture = readOptional('Architecture.md');
	const pitfalls = entries.filter((e) => e.type === 'incident').slice(0, 6);
	const recent = entries.slice(0, 8);
	const debt = entries.filter((e) => e.type === 'technical-debt' || e.status === 'open-debt');
	const open = entries.filter((e) => e.status === 'open');

	return [
		'---',
		'status: active',
		'project: githubarchiver',
		'type: digest',
		'generated: true',
		'---',
		'',
		'# Project Digest',
		'',
		genBanner(),
		'',
		'If an agent can load only one memory document, load this.',
		'',
		'## Purpose',
		'',
		'GithubArchive+ is an evidence-first GitHub repository intelligence platform: discover repos, enrich them, classify/cluster/score, tell Archive Stories, and preserve evidence.',
		'',
		'## Architecture',
		'',
		extractBullets(architecture, 12) ||
			'- SvelteKit + SQLite + GH Archive ingest + Search fallback + background daemon',
		'',
		'## Core principles',
		'',
		extractBullets(principles, 16) || '- See Decisions.md',
		'',
		'## Current pipeline',
		'',
		'Discovery (GH Archive → optional Search gap) → Ingestion → Enrichment → Clustering/scoring → Preservation. Daemon must not let enrichment backlog pause ingest. Status labels must match runtime behavior.',
		'',
		'## Known pitfalls',
		'',
		pitfalls.length
			? pitfalls.map((e) => `- [${e.title}](${e.relPath})${e.summary ? ` — ${e.summary}` : ''}`).join('\n')
			: '_None recorded._',
		'',
		'## Recent changes',
		'',
		recent.map((e) => lineFor(e, aliases)).join('\n'),
		'',
		'## Open technical debt',
		'',
		debt.length ? debt.map((e) => lineFor(e, aliases)).join('\n') : '_None._',
		'',
		'## Current priorities',
		'',
		open.length ? open.map((e) => lineFor(e, aliases)).join('\n') : '_None open._',
		'',
		'## Important files',
		'',
		'- `src/lib/server/background-daemon.ts`',
		'- `src/lib/server/daemon-planner.ts`',
		'- `src/lib/server/gharchive.ts`',
		'- `src/lib/server/repo-discovery.ts`',
		'- `src/lib/server/db/search-ingest.ts`',
		'- `src/lib/components/StatusStory.svelte`',
		'- `src/lib/components/ActivityStatusBar.svelte`',
		'- `docs/ai-memory/seed/02 - Projects/GithubArchiver/entries/`',
		''
	].join('\n');
}

function readOptional(name: string): string {
	try {
		return readFileSync(join(ROOT, name), 'utf8');
	} catch {
		return '';
	}
}

function extractBullets(md: string, limit: number): string {
	const bullets = md
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.startsWith('- '));
	return bullets.slice(0, limit).join('\n');
}

function renderKnowledgeGraph(entries: Entry[], aliases: Map<string, Entry>): string {
	const lines = entries.map((e) => {
		const rel =
			e.related.length > 0
				? e.related.map((r) => linkRef(r, aliases)).join(', ')
				: '_none_';
		const supersedes = e.supersedes ? linkRef(e.supersedes, aliases) : '_none_';
		return `- [\`${e.id}\`](${e.relPath}) (\`${e.type}\`) — ${e.title}\n  - related: ${rel}\n  - supersedes: ${supersedes}`;
	});

	return [
		'---',
		'status: active',
		'project: githubarchiver',
		'type: knowledge-graph',
		'generated: true',
		'---',
		'',
		'# Knowledge Graph',
		'',
		genBanner(),
		'',
		'Edges come from each entry’s `related` and `supersedes` fields. IDs may be entry stems, `pr-N`, `migration-NNN`, or explicit `id:` values.',
		'',
		...lines,
		''
	].join('\n');
}

function renderTypeIndex(type: EntryType, entries: Entry[], aliases: Map<string, Entry>): string {
	const items =
		type === 'migration'
			? entries.filter((e) => e.type === 'migration' || e.migration != null)
			: type === 'technical-debt'
				? entries.filter((e) => e.type === 'technical-debt' || e.status === 'open-debt')
				: entries.filter((e) => e.type === type);

	return [
		'---',
		'status: active',
		'project: githubarchiver',
		`type: ${type}-index`,
		'generated: true',
		'---',
		'',
		`# ${type}`,
		'',
		genBanner(),
		'',
		items.length ? items.map((e) => lineFor(e, aliases)).join('\n') : '_None yet._',
		''
	].join('\n');
}

function renderConvenience(
	title: string,
	items: Entry[],
	aliases: Map<string, Entry>,
	typeTag: string
): string {
	return [
		'---',
		'status: active',
		'project: githubarchiver',
		`type: ${typeTag}`,
		'generated: true',
		'---',
		'',
		`# ${title}`,
		'',
		genBanner(),
		'',
		items.length ? items.map((e) => lineFor(e, aliases)).join('\n') : '_None yet._',
		''
	].join('\n');
}

function writeOrCheck(path: string, content: string): boolean {
	if (CHECK) {
		let existing = '';
		try {
			existing = readFileSync(path, 'utf8');
		} catch {
			console.error(`missing generated file: ${path}`);
			return false;
		}
		if (existing !== content) {
			console.error(`out of date: ${path}`);
			return false;
		}
		return true;
	}
	mkdirSync(resolve(path, '..'), { recursive: true });
	writeFileSync(path, content);
	console.log(`wrote ${path}`);
	return true;
}

const entries = loadEntries();
const aliases = buildAliasIndex(entries);
let ok = true;

ok = writeOrCheck(join(ROOT, 'Timeline.md'), renderTimeline(entries, aliases)) && ok;
ok = writeOrCheck(join(ROOT, 'Current Status.md'), renderCurrentStatus(entries, aliases)) && ok;
ok = writeOrCheck(join(ROOT, 'Project Digest.md'), renderDigest(entries, aliases)) && ok;
ok = writeOrCheck(join(ROOT, 'Knowledge Graph.md'), renderKnowledgeGraph(entries, aliases)) && ok;

if (!CHECK) mkdirSync(INDEXES_DIR, { recursive: true });
for (const type of ENTRY_TYPES) {
	ok = writeOrCheck(join(INDEXES_DIR, `${type}.md`), renderTypeIndex(type, entries, aliases)) && ok;
}

ok =
	writeOrCheck(
		join(ROOT, 'PR Timeline.md'),
		renderConvenience(
			'PR Timeline',
			entries.filter((e) => e.pr != null),
			aliases,
			'pr-timeline'
		)
	) && ok;
ok =
	writeOrCheck(
		join(ROOT, 'Production Incidents.md'),
		renderConvenience(
			'Production Incidents',
			entries.filter((e) => e.type === 'incident'),
			aliases,
			'incidents'
		)
	) && ok;
ok =
	writeOrCheck(
		join(ROOT, 'Migrations.md'),
		renderConvenience(
			'Migrations',
			entries
				.filter((e) => e.type === 'migration' || e.migration != null)
				.slice()
				.sort((a, b) => (b.migration ?? 0) - (a.migration ?? 0)),
			aliases,
			'migrations'
		)
	) && ok;
ok =
	writeOrCheck(
		join(ROOT, 'Open Technical Debt.md'),
		renderConvenience(
			'Open Technical Debt',
			entries.filter((e) => e.type === 'technical-debt' || e.status === 'open-debt'),
			aliases,
			'debt'
		)
	) && ok;

// Remove obsolete PR #8 generated name if present
const obsolete = join(ROOT, 'Architecture Decisions.md');
if (!CHECK) {
	try {
		rmSync(obsolete);
		console.log(`removed obsolete ${obsolete}`);
	} catch {
		/* absent */
	}
}

if (CHECK) {
	if (!ok) {
		console.error('Memory views are stale. Run: npm run memory:timeline');
		process.exit(1);
	}
	console.log(`ok: ${entries.length} entries`);
}
