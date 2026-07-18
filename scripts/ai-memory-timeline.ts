#!/usr/bin/env tsx
/**
 * Regenerate GithubArchiver memory timeline indexes from structured entry frontmatter.
 *
 * Usage:
 *   npx tsx scripts/ai-memory-timeline.ts
 *   npx tsx scripts/ai-memory-timeline.ts --check
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(
	process.env.AI_MEMORY_ENTRIES ??
		'docs/ai-memory/seed/02 - Projects/GithubArchiver'
);
const ENTRIES_DIR = join(ROOT, 'entries');
const CHECK = process.argv.includes('--check');

type EntryType = 'architecture' | 'incident' | 'migration' | 'pr' | 'debt';
type EntryStatus = 'merged' | 'open' | 'verified' | 'superseded' | 'open-debt';

interface Entry {
	stem: string;
	date: string;
	pr: number | null;
	commit: string | null;
	area: string[];
	type: EntryType;
	status: EntryStatus;
	supersedes: string | null;
	title: string;
	migration: number | null;
	relPath: string;
}

const TYPE_FILES: Record<EntryType, { file: string; heading: string }> = {
	architecture: { file: 'Architecture Decisions.md', heading: 'Architecture Decisions' },
	incident: { file: 'Production Incidents.md', heading: 'Production Incidents' },
	migration: { file: 'Migrations.md', heading: 'Migrations' },
	pr: { file: 'PR Timeline.md', heading: 'PR Timeline' },
	debt: { file: 'Open Technical Debt.md', heading: 'Open Technical Debt' }
};

function parseScalar(raw: string): string | number | null {
	const v = raw.trim();
	if (v === 'null' || v === '~' || v === '') return null;
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
		return v.slice(1, -1);
	}
	if (/^-?\d+$/.test(v)) return Number(v);
	return v;
}

function parseFrontmatter(text: string): Record<string, unknown> {
	if (!text.startsWith('---\n')) throw new Error('missing frontmatter open');
	const end = text.indexOf('\n---\n', 4);
	if (end < 0) throw new Error('missing frontmatter close');
	const block = text.slice(4, end);
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
	return out;
}

function loadEntries(): Entry[] {
	const files = readdirSync(ENTRIES_DIR)
		.filter((f) => f.endsWith('.md') && f !== 'SCHEMA.md')
		.sort();
	const entries: Entry[] = [];
	for (const file of files) {
		const text = readFileSync(join(ENTRIES_DIR, file), 'utf8');
		const fm = parseFrontmatter(text);
		const type = String(fm.type) as EntryType;
		if (!TYPE_FILES[type]) throw new Error(`${file}: invalid type ${fm.type}`);
		const status = String(fm.status) as EntryStatus;
		const area = Array.isArray(fm.area) ? fm.area.map(String) : [];
		entries.push({
			stem: file.replace(/\.md$/, ''),
			date: String(fm.date),
			pr: fm.pr == null ? null : Number(fm.pr),
			commit: fm.commit == null ? null : String(fm.commit),
			area,
			type,
			status,
			supersedes: fm.supersedes == null ? null : String(fm.supersedes),
			title: String(fm.title ?? ''),
			migration: fm.migration == null ? null : Number(fm.migration),
			relPath: `entries/${file}`
		});
		if (!entries.at(-1)?.title) throw new Error(`${file}: title required`);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(entries.at(-1)!.date)) {
			throw new Error(`${file}: date must be YYYY-MM-DD`);
		}
	}
	return entries.sort((a, b) => {
		if (a.date !== b.date) return a.date < b.date ? 1 : -1; // newest first
		const ap = a.pr ?? -1;
		const bp = b.pr ?? -1;
		return bp - ap;
	});
}

function lineFor(e: Entry): string {
	const bits = [`**${e.date}**`];
	if (e.pr != null) bits.push(`PR #${e.pr}`);
	if (e.commit) bits.push(`\`${e.commit}\``);
	if (e.migration != null) bits.push(`migration ${e.migration}`);
	bits.push(`\`${e.status}\``);
	if (e.area.length) bits.push(e.area.map((a) => `\`${a}\``).join(', '));
	return `- ${bits.join(' · ')} — [${e.title}](${e.relPath})`;
}

function renderSection(title: string, items: Entry[]): string {
	const body = items.length ? items.map(lineFor).join('\n') : '_None yet._';
	return `## ${title}\n\n${body}\n`;
}

function renderTimeline(entries: Entry[]): string {
	const byType = (t: EntryType) => entries.filter((e) => e.type === t);
	// Migrations: type=migration OR any entry with migration number
	const migrations = entries
		.filter((e) => e.type === 'migration' || e.migration != null)
		.slice()
		.sort((a, b) => (b.migration ?? 0) - (a.migration ?? 0));
	const prs = entries.filter((e) => e.pr != null || e.type === 'pr');
	const debt = entries.filter((e) => e.type === 'debt' || e.status === 'open-debt');

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
		'> Generated by `npm run memory:timeline` from `entries/*.md`. Do not edit by hand.',
		'',
		'```text',
		'GithubArchiver',
		'│',
		'├── Architecture Decisions',
		'├── Production Incidents',
		'├── Migrations',
		'├── PR Timeline',
		'├── Open Technical Debt',
		'└── Current Status',
		'```',
		'',
		renderSection('Architecture Decisions', byType('architecture')),
		renderSection('Production Incidents', byType('incident')),
		renderSection('Migrations', migrations),
		renderSection('PR Timeline', prs),
		renderSection('Open Technical Debt', debt),
		'## Chronological (newest first)',
		'',
		entries.map(lineFor).join('\n'),
		''
	].join('\n');
}

function renderCategory(type: EntryType, entries: Entry[]): string {
	const meta = TYPE_FILES[type];
	const items =
		type === 'migration'
			? entries.filter((e) => e.type === 'migration' || e.migration != null)
			: type === 'pr'
				? entries.filter((e) => e.pr != null || e.type === 'pr')
				: type === 'debt'
					? entries.filter((e) => e.type === 'debt' || e.status === 'open-debt')
					: entries.filter((e) => e.type === type);

	return [
		'---',
		'status: active',
		'project: githubarchiver',
		`type: ${type}-index`,
		'generated: true',
		'---',
		'',
		`# ${meta.heading}`,
		'',
		'> Generated by `npm run memory:timeline` from `entries/*.md`. Do not edit by hand.',
		'',
		items.length ? items.map(lineFor).join('\n') : '_None yet._',
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
	mkdirSync(ROOT, { recursive: true });
	writeFileSync(path, content);
	console.log(`wrote ${path}`);
	return true;
}

const entries = loadEntries();
let ok = true;
ok = writeOrCheck(join(ROOT, 'Timeline.md'), renderTimeline(entries)) && ok;
for (const type of Object.keys(TYPE_FILES) as EntryType[]) {
	const { file } = TYPE_FILES[type];
	ok = writeOrCheck(join(ROOT, file), renderCategory(type, entries)) && ok;
}

if (CHECK) {
	if (!ok) {
		console.error('Timeline indexes are stale. Run: npm run memory:timeline');
		process.exit(1);
	}
	console.log(`ok: ${entries.length} entries`);
}
