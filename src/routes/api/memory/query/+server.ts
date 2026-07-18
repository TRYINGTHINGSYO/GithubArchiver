import { json } from '@sveltejs/kit';
import { runMemoryQuery, serializeEntry } from '$lib/server/memory-center';
import type { RequestHandler } from './$types';

/** Live retrieval for the Memory Center (READ-ONLY). */
export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	if (!q) {
		return json({ error: 'q parameter is required' }, { status: 400 });
	}

	const budgetRaw = url.searchParams.get('budget');
	const budget = budgetRaw != null ? Number(budgetRaw) : 6000;
	const started = performance.now();
	const result = runMemoryQuery(q, Number.isFinite(budget) ? budget : 6000);
	const elapsedMs = Math.round(performance.now() - started);

	return json({
		query: q,
		elapsedMs,
		metrics: result.metrics,
		stages: result.stages,
		hits: result.assembled.map((h) => ({
			id: h.entry.id,
			title: h.entry.title,
			type: h.entry.type,
			score: h.score,
			reasons: h.reasons,
			depth: h.depth,
			via: h.via,
			summary: h.entry.summary,
			confidence: h.entry.confidence,
			durability: h.entry.durability,
			status: h.entry.status
		})),
		candidates: result.candidates.slice(0, 12).map((h) => ({
			id: h.entry.id,
			title: h.entry.title,
			score: h.score
		}))
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { q?: string; budget?: number };
	const q = (body.q ?? '').trim();
	if (!q) {
		return json({ error: 'q is required' }, { status: 400 });
	}
	const started = performance.now();
	const result = runMemoryQuery(q, body.budget ?? 6000);
	const elapsedMs = Math.round(performance.now() - started);
	return json({
		query: q,
		elapsedMs,
		metrics: result.metrics,
		stages: result.stages,
		entry: result.assembled[0] ? serializeEntry(result.assembled[0].entry) : null,
		hits: result.assembled.map((h) => ({
			id: h.entry.id,
			title: h.entry.title,
			type: h.entry.type,
			score: h.score,
			reasons: h.reasons,
			summary: h.entry.summary
		}))
	});
};
