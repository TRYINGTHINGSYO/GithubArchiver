#!/usr/bin/env tsx
/**
 * Multi-stage ranked retrieval (READ-ONLY) over the project knowledge engine.
 *
 *   Stage 1 — Candidate retrieval
 *   Stage 2 — Typed graph expansion
 *   Stage 3 — Re-rank
 *   Assemble under optional --budget tokens
 *
 * This command never writes to the vault.
 */
import {
	RELATION_TYPES,
	type RelationType,
	clusterHits,
	defaultMemoryRoot,
	loadMemoryEntries,
	queryMemoryDetailed,
	rootCauses,
	buildAliasIndex
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
const candidates = Number(argValue('--candidates') ?? 20);
const budgetRaw = argValue('--budget');
const budget = budgetRaw != null ? Number(budgetRaw) : undefined;
const followRaw = argValue('--follow');
const follow = followRaw
	? (followRaw.split(',').map((s) => s.trim()) as RelationType[])
	: undefined;

if (follow) {
	for (const t of follow) {
		if (!(RELATION_TYPES as readonly string[]).includes(t)) {
			console.error(`Unknown relationship type: ${t}`);
			process.exit(2);
		}
	}
}

const flagsWithValues = new Set(['--depth', '--limit', '--candidates', '--budget', '--follow']);
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
			'READ-ONLY retrieval. Durable knowledge is appended via entries/*.md only.',
			'',
			'Options:',
			'  --candidates N            stage-1 pool (default 20)',
			'  --depth N                 expansion hops (default 2)',
			'  --limit N                 max assembled hits (default 8)',
			'  --budget N                approx token budget (chars/4)',
			'  --follow a,b,c            edge types to expand (default all)',
			'  --include-hypotheses',
			'  --include-deprecated',
			'  --json'
		].join('\n')
	);
	process.exit(2);
}

const root = defaultMemoryRoot();
const entries = loadMemoryEntries(root);
const result = queryMemoryDetailed(entries, query, {
	depth,
	limit,
	candidates,
	budget,
	follow,
	includeHypotheses,
	includeDeprecated
});
const hits = result.assembled;
const clusters = clusterHits(hits);
const aliases = buildAliasIndex(entries);
const m = result.metrics;

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
				metrics: m,
				ranking: hits.map((h, i) => ({
					rank: i + 1,
					score: Number(h.score.toFixed(1)),
					id: h.entry.id,
					type: h.entry.type,
					confidence: h.entry.confidence,
					durability: h.entry.durability,
					edgeType: h.edgeType ?? null,
					reasons: h.reasons,
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
					durability: h.entry.durability,
					status: h.entry.status,
					date: h.entry.date,
					pr: h.entry.pr,
					migration: h.entry.migration,
					score: Number(h.score.toFixed(3)),
					reasons: h.reasons,
					breakdown: h.breakdown,
					via: h.via,
					edgeType: h.edgeType ?? null,
					depth: h.depth,
					title: h.entry.title,
					relationships: h.entry.relationships,
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

const budgetLine =
	m.budget != null
		? `Budget: ${m.tokensUsed.toLocaleString()} / ${m.budget.toLocaleString()} tokens`
		: `Tokens (est.): ${m.tokensUsed.toLocaleString()}`;

const lines: string[] = [
	`# Memory query: ${query}`,
	'',
	'## Metrics',
	'',
	`Candidates: ${m.candidates}`,
	`Expanded: ${m.expanded}`,
	`Ranked: ${m.ranked}`,
	`Returned: ${m.returned}`,
	budgetLine,
	`Confidence filter: ${confidenceNote}`,
	'',
	'## Ranking (with explanations)',
	''
];

hits.forEach((h, i) => {
	lines.push(`${i + 1}. \`${h.entry.id}\` (${h.score.toFixed(0)}) — ${h.entry.title}`);
	for (const reason of h.reasons) {
		lines.push(`   ✓ ${reason}`);
	}
	lines.push('');
});

const causes = new Map<string, string>();
for (const h of hits) {
	for (const c of rootCauses(h.entry, aliases)) {
		causes.set(c.id, c.title);
	}
}
if (causes.size) {
	lines.push('## Root cause (via caused-by)');
	lines.push('');
	for (const [id, title] of causes) {
		lines.push(`- \`${id}\` — ${title}`);
	}
	lines.push('');
}

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
		lines.push(
			`- \`${e.id}\` — ${e.title} _(score ${h.score.toFixed(0)} · ${e.durability})_`
		);
		if (e.summary) lines.push(`  - ${e.summary}`);
	}
	lines.push('');
}

console.log(lines.join('\n'));
