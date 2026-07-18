#!/usr/bin/env tsx
/**
 * Graph-aware retrieval over GithubArchiver memory entries.
 *
 * Usage:
 *   npm run memory:query -- "search fallback"
 *   npm run memory:query -- "search fallback" --json
 *   npm run memory:query -- incident-gharchive-createevent --depth 2
 */
import { defaultMemoryRoot, loadMemoryEntries, queryMemory } from './lib/ai-memory.js';

function argValue(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
	return undefined;
}

const asJson = process.argv.includes('--json');
const includeDeprecated = process.argv.includes('--include-deprecated');
const depth = Number(argValue('--depth') ?? 2);
const limit = Number(argValue('--limit') ?? 12);

const flagsWithValues = new Set(['--depth', '--limit']);
const queryTokens: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
	const a = process.argv[i];
	if (a.startsWith('--')) {
		if (flagsWithValues.has(a)) i += 1;
		continue;
	}
	queryTokens.push(a);
}
const query = queryTokens.join(' ').trim();

if (!query) {
	console.error('Usage: npm run memory:query -- "<terms or id>" [--depth 2] [--limit 12] [--json]');
	process.exit(2);
}

const root = defaultMemoryRoot();
const entries = loadMemoryEntries(root);
const hits = queryMemory(entries, query, { depth, limit, includeDeprecated });

if (asJson) {
	console.log(
		JSON.stringify(
			{
				query,
				root,
				count: hits.length,
				hits: hits.map((h) => ({
					id: h.entry.id,
					type: h.entry.type,
					confidence: h.entry.confidence,
					status: h.entry.status,
					date: h.entry.date,
					pr: h.entry.pr,
					migration: h.entry.migration,
					score: Number(h.score.toFixed(3)),
					via: h.via,
					depth: h.depth,
					title: h.entry.title,
					related: h.entry.related,
					path: h.entry.relPath,
					summary: h.entry.summary
				}))
			},
			null,
			2
		)
	);
	process.exit(0);
}

if (hits.length === 0) {
	console.log(`# Memory query\n\nNo hits for: \`${query}\`\n`);
	process.exit(0);
}

const lines: string[] = [
	`# Memory query: ${query}`,
	'',
	`Assembled ${hits.length} entries via metadata match + graph traversal (depth=${depth}).`,
	''
];

for (const h of hits) {
	const e = h.entry;
	lines.push(`## ${e.type}: ${e.title}`);
	lines.push('');
	lines.push(
		`- id: \`${e.id}\` · confidence: \`${e.confidence}\` · status: \`${e.status}\` · ${e.date}`
	);
	if (e.pr != null) lines.push(`- pr: #${e.pr}`);
	if (e.migration != null) lines.push(`- migration: ${e.migration}`);
	if (e.commit) lines.push(`- commit: \`${e.commit}\``);
	if (e.area.length) lines.push(`- area: ${e.area.map((a) => `\`${a}\``).join(', ')}`);
	if (e.related.length) lines.push(`- related: ${e.related.map((r) => `\`${r}\``).join(', ')}`);
	lines.push(`- score: ${h.score.toFixed(2)} · via: \`${h.via}\` · depth: ${h.depth}`);
	lines.push(`- path: \`${e.relPath}\``);
	lines.push('');
	if (e.summary) {
		lines.push(e.summary);
		lines.push('');
	}
}

console.log(lines.join('\n'));
