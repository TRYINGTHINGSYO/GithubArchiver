import { describe, expect, it } from 'vitest';
import {
	MEMORY_SCHEMA_VERSION,
	clusterHits,
	composeScore,
	estimateTokens,
	explainHit,
	loadMemoryEntries,
	queryMemory,
	queryMemoryDetailed,
	rootCauses,
	buildAliasIndex,
	scoreConceptMatch,
	toMemoryIndex
} from '../scripts/lib/ai-memory';

describe('ai memory multi-stage retrieval', () => {
	const entries = loadMemoryEntries();

	it('requires stable ids, confidence, durability, and schema', () => {
		for (const e of entries) {
			expect(e.id).toBeTruthy();
			expect(e.confidence).toMatch(/^(confirmed|hypothesis|deprecated)$/);
			expect(e.durability).toMatch(/^(transient|temporary|release|permanent)$/);
			expect(e.schema).toBeLessThanOrEqual(MEMORY_SCHEMA_VERSION);
		}
		expect(toMemoryIndex(entries).schema).toBe(MEMORY_SCHEMA_VERSION);
	});

	it('parses typed relationships and explains caused-by', () => {
		const stale = entries.find((e) => e.id === 'incident-search-fallback-stale');
		expect(stale).toBeTruthy();
		const aliases = buildAliasIndex(entries);
		expect(rootCauses(stale!, aliases).map((c) => c.id)).toContain(
			'incident-gharchive-createevent'
		);
	});

	it('runs candidate → expand → re-rank with metrics and reasons', () => {
		const detailed = queryMemoryDetailed(entries, 'search fallback', {
			depth: 2,
			candidates: 20,
			limit: 8
		});
		expect(detailed.metrics.candidates).toBeGreaterThan(0);
		expect(detailed.metrics.expanded).toBeGreaterThanOrEqual(detailed.metrics.candidates);
		expect(detailed.metrics.returned).toBe(detailed.assembled.length);
		expect(detailed.assembled[0].reasons.length).toBeGreaterThan(0);
		expect(detailed.assembled[0].reasons.some((r) => /confidence=/.test(r))).toBe(true);

		const ids = detailed.assembled.map((h) => h.entry.id);
		expect(ids).toContain('incident-search-fallback-stale');
		expect(ids).toContain('incident-gharchive-createevent');
		expect(clusterHits(detailed.assembled).has('incident')).toBe(true);
	});

	it('explainHit surfaces inbound typed edges', () => {
		const create = entries.find((e) => e.id === 'incident-gharchive-createevent')!;
		const hit = {
			entry: create,
			score: 90,
			breakdown: composeScore({
				concept: 30,
				edge: 25,
				confidence: 15,
				recency: 10,
				durability: 5,
				status: 1
			}),
			via: 'caused-by:incident-search-fallback-stale',
			depth: 1,
			edgeType: 'caused-by' as const
		};
		const reasons = explainHit(hit, entries);
		expect(reasons.some((r) => r.includes('caused-by'))).toBe(true);
	});

	it('respects token budget when assembling context', () => {
		const tight = queryMemoryDetailed(entries, 'search fallback', {
			budget: 200,
			limit: 20,
			candidates: 20
		});
		expect(tight.assembled.length).toBeGreaterThan(0);
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
		expect(queryMemory(withHypo, 'search fallback', { limit: 20 }).every((h) => h.entry.confidence === 'confirmed')).toBe(
			true
		);
		expect(
			queryMemory(withHypo, 'search fallback', { limit: 20, includeHypotheses: true }).some(
				(h) => h.entry.id === 'research-temp-hypothesis'
			)
		).toBe(true);
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
