#!/usr/bin/env tsx
/**
 * Ranked, graph-aware retrieval over GithubArchiver memory entries.
 *
 * Usage:
 *   npm run memory:query -- "search fallback"
 *   npm run memory:query -- "search fallback" --include-hypotheses
 *   npm run memory:query -- "search fallback" --json
 *   npm run memory:query -- incident-gharchive-createevent --depth 2 --limit 6
 *
 * Default: confirmed knowledge only (excludes hypothesis + deprecated).
 */
import {
	clusterHits,
	defaultMemoryRoot,
	loadMemoryEntries,
	queryMemory
} from './lib/ai-memory.js';

function argValue(flag: string): string | undefined {
	const i = process.argv.indexOf(flag);
	if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
	return undefined;
}

const asJson = process.argv.includes('--json');
const includeHypotheses =
	process.argv.includes('--include-hypotheses') || process.argv.includes('--include-hypothesis');
const includeDeprecated = process.argv.includes('--include-deprecated');
const depth = Number(argValue('--depth') ?? 2);
const limit = Number(argValue('--limit') ?? 8);

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
	console.error(
		[
			'Usage: npm run memory:query -- "<terms or id>" [options]',
			'',
			'Options:',
			'  --depth N                 graph expansion depth (default 2)',
			'  --limit N                 max ranked hits (default 8)',
			'  --include-hypotheses      include confidence: hypothesis',
			'  --include-deprecated      include confidence: deprecated',
			'  --json                    machine-readable output',
			'',
			'Default confidence filter: confirmed only.'
		].join('\n')
	);
	process.exit(2);
}

const root = defaultMemoryRoot();
const entries = loadMemoryEntries(root);
const hits = queryMemory(entries, query, {
	depth,
	limit,
	includeHypotheses,
	includeDeprecated
});
const clusters = clusterHits(hits);

const confidenceNote = includeHypotheses
	? includeDeprecated
		? 'all confidences'
		: 'confirmed + hypothesis'
	: includeDeprecated
		? 'confirmed + deprecated'
		: 'confirmed only';

if (asJson) {
	console.log(
		JSON.stringify(
			{
				query,
				root,
				confidence: confidenceNote,
				count: hits.length,
				ranking: hits.map((h) => ({
					score: Number(h.score.toFixed(1)),
					id: h.entry.id,
					type: h.entry.type,
					confidence: h.entry.confidence,
					breakdown: h.breakdown,
					depth: h.depth,
					via: h.via,
					title: h.entry.title
				})),
				clusters: Object.fromEntries(
					[...clusters.entries()].map(([type, list]) => [
						type,
						list.map((h) => ({
							score: Number(h.score.toFixed(1)),
							id: h.entry.id,
							title: h.entry.title
						}))
					])
				),
				hits: hits.map((h) => ({
					id: h.entry.id,
					type: h.entry.type,
					confidence: h.entry.confidence,
					status: h.entry.status,
					date: h.entry.date,
					pr: h.entry.pr,
					migration: h.entry.migration,
					score: Number(h.score.toFixed(3)),
					breakdown: h.breakdown,
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
	console.log(
		`# Memory query: ${query}\n\nNo hits (${confidenceNote}). Try \`--include-hypotheses\` if you need investigations.\n`
	);
	process.exit(0);
}

const lines: string[] = [
	`# Memory query: ${query}`,
	'',
	`Ranked ${hits.length} entries · confidence filter: **${confidenceNote}** · depth=${depth}`,
	'',
	'## Ranking',
	'',
	'| Score | ID | Type | Confidence |',
	'| ----: | --- | --- | --- |',
	...hits.map(
		(h) =>
			`| ${h.score.toFixed(0)} | \`${h.entry.id}\` | ${h.entry.type} | ${h.entry.confidence} |`
	),
	''
];

const typeHeadings: Record<string, string> = {
	decision: 'Decision',
	incident: 'Incident',
	migration: 'Migration',
	'technical-debt': 'Technical Debt',
	feature: 'Feature',
	bugfix: 'Bugfix',
	performance: 'Performance',
	refactor: 'Refactor',
	test: 'Test',
	release: 'Release',
	research: 'Research'
};

for (const [type, list] of clusters) {
	lines.push(`## ${typeHeadings[type] ?? type}`);
	lines.push('');
	for (const h of list) {
		const e = h.entry;
		const meta = [
			`score ${h.score.toFixed(0)}`,
			e.confidence,
			e.pr != null ? `PR #${e.pr}` : null,
			e.migration != null ? `migration ${e.migration}` : null
		]
			.filter(Boolean)
			.join(' · ');
		lines.push(`- \`${e.id}\` — ${e.title} _(${meta})_`);
		if (e.summary) lines.push(`  - ${e.summary}`);
	}
	lines.push('');
}

const openish = hits.filter(
	(h) => h.entry.status === 'open' || h.entry.status === 'open-debt' || h.entry.status === 'verified'
);
if (openish.length) {
	lines.push('## Current Status (from hits)');
	lines.push('');
	for (const h of openish) {
		lines.push(
			`- \`${h.entry.id}\` · \`${h.entry.status}\` — ${h.entry.title}`
		);
	}
	lines.push('');
}

lines.push('## Score model');
lines.push('');
lines.push(
	'`total = concept(≤40) + edge(≤25) + confidence(≤15) + recency(≤10) + durability(≤5) + status(≤5)`'
);
lines.push('');

console.log(lines.join('\n'));
