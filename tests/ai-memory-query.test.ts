import { describe, expect, it } from 'vitest';
import {
	clusterHits,
	composeScore,
	estimateTokens,
	loadMemoryEntries,
	queryMemory,
	queryMemoryDetailed,
	rootCauses,
	buildAliasIndex,
	scoreConceptMatch,
	scoreConfidence,
	scoreEdgeDistance
} from '../scripts/lib/ai-memory';

describe('ai memory multi-stage retrieval', () => {
	const entries = loadMemoryEntries();

	it('requires stable ids, confidence, and durability', () => {
		for (const e of entries) {
			expect(e.id).toBeTruthy();
			expect(e.confidence).toMatch(/^(confirmed|hypothesis|deprecated)$/);
			expect(e.durability).toMatch(/^(transient|temporary|release|permanent)$/);
		}
	});

	it('parses typed relationships on search-fallback incident', () => {
		const stale = entries.find((e) => e.id === 'incident-search-fallback-stale');
		expect(stale).toBeTruthy();
		expect(stale!.relationships.some((r) => r.type === 'caused-by')).toBe(true);
		const aliases = buildAliasIndex(entries);
		const causes = rootCauses(stale!, aliases);
		expect(causes.map((c) => c.id)).toContain('incident-gharchive-createevent');
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
		expect(scoreConfidence('confirmed')).toBe(15);
	});

	it('runs candidate → expand → re-rank pipeline for search fallback', () => {
		const detailed = queryMemoryDetailed(entries, 'search fallback', {
			depth: 2,
			candidates: 20,
			limit: 8
		});
		expect(detailed.stages.candidates).toBeGreaterThan(0);
		expect(detailed.stages.expanded).toBeGreaterThanOrEqual(detailed.stages.candidates);
		expect(detailed.assembled.length).toBeGreaterThan(0);
		expect(detailed.assembled[0].score).toBeGreaterThanOrEqual(
			detailed.assembled.at(-1)!.score
		);

		const ids = detailed.assembled.map((h) => h.entry.id);
		expect(ids).toContain('incident-search-fallback-stale');
		expect(ids).toContain('incident-gharchive-createevent');
		expect(clusterHits(detailed.assembled).has('incident')).toBe(true);
	});

	it('respects token budget when assembling context', () => {
		const tight = queryMemoryDetailed(entries, 'search fallback', {
			budget: 200,
			limit: 20,
			candidates: 20
		});
		expect(tight.assembled.length).toBeGreaterThan(0);
		expect(tight.assembled.length).toBeLessThanOrEqual(tight.stages.ranked);
		expect(tight.tokensUsed).toBeLessThanOrEqual(220);
		expect(estimateTokens('abcd')).toBe(1);
	});

	it('defaults to confirmed-only (excludes hypothesis)', () => {
		const hypo = {
			...entries[0],
			id: 'research-temp-hypothesis',
			type: 'research' as const,
			confidence: 'hypothesis' as const,
			durability: 'transient' as const,
			title: 'search fallback wild theory',
			area: ['search-fallback'],
			related: ['incident-search-fallback-stale'],
			relationships: [{ type: 'related' as const, id: 'incident-search-fallback-stale' }],
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
		expect(
			scoreConceptMatch(
				hits[0].entry,
				['incident-gharchive-createevent'],
				'incident-gharchive-createevent'
			)
		).toBeGreaterThanOrEqual(40);
	});
});
