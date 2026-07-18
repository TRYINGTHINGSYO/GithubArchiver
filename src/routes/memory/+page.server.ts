import { renderMarkdownSafe } from '$lib/server/markdown';
import {
	buildInvestigation,
	buildMemoryGraph,
	computeMemoryStats,
	getMemoryCorpus,
	runMemoryQuery,
	serializeEntry,
	type SerializedEntry
} from '$lib/server/memory-center';
import { resolveRef, buildAliasIndex } from '$lib/server/ai-memory';
import type { PageServerLoad } from './$types';

const VIEWS = new Set(['timeline', 'graph', 'retrieval']);

export const load: PageServerLoad = async ({ url }) => {
	const entries = getMemoryCorpus();
	const aliases = buildAliasIndex(entries);
	const stats = computeMemoryStats(entries);
	const graph = buildMemoryGraph(entries);

	const viewParam = url.searchParams.get('view') ?? 'timeline';
	const view = VIEWS.has(viewParam) ? viewParam : 'timeline';
	const q = (url.searchParams.get('q') ?? '').trim();
	const selectedId = (url.searchParams.get('id') ?? '').trim();

	const serialized = entries
		.slice()
		.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
		.map(serializeEntry);

	let selected: (SerializedEntry & { html: string }) | null = null;
	let investigation: ReturnType<typeof buildInvestigation> = [];
	if (selectedId) {
		const entry = resolveRef(selectedId, aliases);
		if (entry) {
			const s = serializeEntry(entry);
			selected = { ...s, html: renderMarkdownSafe(entry.body) };
			investigation = buildInvestigation(entry.id, entries);
		}
	}

	let retrieval: null | {
		query: string;
		elapsedMs: number;
		metrics: ReturnType<typeof runMemoryQuery>['metrics'];
		stages: ReturnType<typeof runMemoryQuery>['stages'];
		hits: Array<{
			id: string;
			title: string;
			type: string;
			score: number;
			reasons: string[];
			summary: string;
			confidence: string;
			durability: string;
		}>;
	} = null;

	if (q) {
		const started = performance.now();
		const result = runMemoryQuery(q, 6000);
		retrieval = {
			query: q,
			elapsedMs: Math.round(performance.now() - started),
			metrics: result.metrics,
			stages: result.stages,
			hits: result.assembled.map((h) => ({
				id: h.entry.id,
				title: h.entry.title,
				type: h.entry.type,
				score: h.score,
				reasons: h.reasons,
				summary: h.entry.summary,
				confidence: h.entry.confidence,
				durability: h.entry.durability
			}))
		};
	}

	return {
		view,
		q,
		stats,
		graph,
		entries: serialized,
		selected,
		investigation,
		retrieval
	};
};
