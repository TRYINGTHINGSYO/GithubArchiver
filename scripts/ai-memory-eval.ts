#!/usr/bin/env tsx
/**
 * Evaluation harness for the knowledge retrieval engine (READ-ONLY).
 *
 *   npm run memory:eval
 *   npm run memory:eval -- --case search-fallback
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
	RELATION_TYPES,
	type QueryOptions,
	type RelationType,
	defaultMemoryRoot,
	loadMemoryEntries,
	parseFrontmatter,
	queryMemoryDetailed
} from '../src/lib/server/ai-memory.js';

interface EvalCase {
	id: string;
	query: string;
	must_include: string[];
	should_include: string[];
	must_not_include: string[];
	should_not_include: string[];
	options: QueryOptions;
}

const EVAL_DIR = resolve(process.env.AI_MEMORY_EVALS ?? 'docs/ai-memory/evals');
const only = (() => {
	const i = process.argv.indexOf('--case');
	return i >= 0 ? process.argv[i + 1] : undefined;
})();

function arr(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.map(String);
}

function loadCases(): EvalCase[] {
	const files = readdirSync(EVAL_DIR)
		.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
		.sort();
	const cases: EvalCase[] = [];
	for (const file of files) {
		const text = readFileSync(join(EVAL_DIR, file), 'utf8');
		const { fm } = parseFrontmatter(`---\n${text.trim()}\n---\n`);
		const id = String(fm.id ?? file.replace(/\.ya?ml$/, ''));
		if (only && id !== only && !file.startsWith(only)) continue;

		const follow = arr(fm.follow).filter((t) =>
			(RELATION_TYPES as readonly string[]).includes(t)
		) as RelationType[];

		cases.push({
			id,
			query: String(fm.query ?? ''),
			must_include: arr(fm.must_include),
			should_include: arr(fm.should_include),
			must_not_include: arr(fm.must_not_include),
			should_not_include: arr(fm.should_not_include),
			options: {
				limit: fm.limit == null ? 12 : Number(fm.limit),
				depth: fm.depth == null ? 2 : Number(fm.depth),
				candidates: fm.candidates == null ? 20 : Number(fm.candidates),
				budget: fm.budget == null ? undefined : Number(fm.budget),
				follow: follow.length ? follow : undefined,
				includeHypotheses: Boolean(fm.include_hypotheses),
				includeDeprecated: Boolean(fm.include_deprecated)
			}
		});
	}
	return cases;
}

const root = defaultMemoryRoot();
const entries = loadMemoryEntries(root);
const cases = loadCases();

if (cases.length === 0) {
	console.error(`No eval cases found in ${EVAL_DIR}`);
	process.exit(2);
}

let hardFails = 0;
let softFails = 0;

console.log(`# Knowledge retrieval eval\n`);
console.log(`Corpus: ${entries.length} entries · Cases: ${cases.length}\n`);

for (const c of cases) {
	if (!c.query) {
		console.log(`## ${c.id}\nFAIL: missing query\n`);
		hardFails++;
		continue;
	}
	const result = queryMemoryDetailed(entries, c.query, c.options);
	const ids = new Set(result.assembled.map((h) => h.entry.id));
	const missingMust = c.must_include.filter((id) => !ids.has(id));
	const missingShould = c.should_include.filter((id) => !ids.has(id));
	const badMust = c.must_not_include.filter((id) => ids.has(id));
	const badShould = c.should_not_include.filter((id) => ids.has(id));

	const failedHard = missingMust.length > 0 || badMust.length > 0;
	const failedSoft = missingShould.length > 0 || badShould.length > 0;
	if (failedHard) hardFails++;
	else if (failedSoft) softFails++;

	const status = failedHard ? 'FAIL' : failedSoft ? 'WARN' : 'PASS';
	console.log(`## ${c.id} — ${status}`);
	console.log('');
	console.log(`Query: \`${c.query}\``);
	console.log(
		`Metrics: candidates=${result.metrics.candidates} expanded=${result.metrics.expanded} ranked=${result.metrics.ranked} returned=${result.metrics.returned}`
	);
	console.log(`Returned: ${[...ids].map((id) => `\`${id}\``).join(', ') || '_none_'}`);
	if (missingMust.length) console.log(`✗ must_include missing: ${missingMust.join(', ')}`);
	if (badMust.length) console.log(`✗ must_not_include present: ${badMust.join(', ')}`);
	if (missingShould.length) console.log(`⚠ should_include missing: ${missingShould.join(', ')}`);
	if (badShould.length) console.log(`⚠ should_not_include present: ${badShould.join(', ')}`);
	if (!failedHard && !failedSoft) console.log('✓ expectations met');
	console.log('');
}

console.log('---');
console.log(`Hard fails: ${hardFails} · Soft warns: ${softFails} · Cases: ${cases.length}`);
if (hardFails > 0) process.exit(1);
console.log('ok');
