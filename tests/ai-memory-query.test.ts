import { describe, expect, it } from 'vitest';
import {
	clusterHits,
	composeScore,
	loadMemoryEntries,
	queryMemory,
	scoreConceptMatch,
	scoreConfidence,
	scoreEdgeDistance
} from '../scripts/lib/ai-memory';

describe('ai memory query scoring', () => {
	const entries = loadMemoryEntries();

	it('requires stable ids and confidence on every entry', () => {
		for (const e of entries) {
			expect(e.id).toBeTruthy();
			expect(e.confidence).toMatch(/^(confirmed|hypothesis|deprecated)$/);
		}
	});

	it('composes score components into a 0–100-ish total', () => {
		const b = composeScore({
			concept: 40,
			edge: 25,
			confidence: 15,
			recency: 10,
			durability: 5,
			status: 5
		});
		expect(b.total).toBe(100);
		expect(scoreEdgeDistance(0)).toBe(25);
		expect(scoreEdgeDistance(1)).toBe(14);
		expect(scoreConfidence('confirmed')).toBe(15);
		expect(scoreConfidence('hypothesis')).toBe(6);
	});

	it('ranks search-fallback cluster and clusters by type', () => {
		const hits = queryMemory(entries, 'search fallback', { depth: 2, limit: 8 });
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0].score).toBeGreaterThan(hits.at(-1)!.score - 0.001);

		const ids = hits.map((h) => h.entry.id);
		expect(ids).toContain('incident-search-fallback-stale');
		expect(ids).toContain('incident-gharchive-createevent');

		// Top hit should be a strong concept match (incident or decision around search)
		expect(hits[0].breakdown.concept).toBeGreaterThan(0);
		expect(hits[0].entry.confidence).toBe('confirmed');

		const clusters = clusterHits(hits);
		expect(clusters.has('incident')).toBe(true);
	});

	it('defaults to confirmed-only (excludes hypothesis)', () => {
		const hypo = {
			...entries[0],
			id: 'research-temp-hypothesis',
			type: 'research' as const,
			confidence: 'hypothesis' as const,
			title: 'search fallback wild theory',
			area: ['search-fallback'],
			related: ['incident-search-fallback-stale'],
			summary: 'hypothesis about search fallback',
			body: 'search fallback hypothesis'
		};
		const withHypo = [...entries, hypo];
		const confirmed = queryMemory(withHypo, 'search fallback', { limit: 20 });
		expect(confirmed.every((h) => h.entry.confidence === 'confirmed')).toBe(true);

		const withHypotheses = queryMemory(withHypo, 'search fallback', {
			limit: 20,
			includeHypotheses: true
		});
		expect(withHypotheses.some((h) => h.entry.id === 'research-temp-hypothesis')).toBe(true);
	});

	it('can resolve by stable id with high concept score', () => {
		const hits = queryMemory(entries, 'incident-gharchive-createevent', { depth: 1 });
		expect(hits[0]?.entry.id).toBe('incident-gharchive-createevent');
		expect(scoreConceptMatch(hits[0].entry, ['incident-gharchive-createevent'], 'incident-gharchive-createevent')).toBeGreaterThanOrEqual(40);
	});
});
