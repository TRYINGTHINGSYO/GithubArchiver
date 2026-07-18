import { describe, expect, it } from 'vitest';
import {
	buildInvestigation,
	buildMemoryGraph,
	computeMemoryStats,
	getMemoryCorpus,
	runMemoryQuery
} from '../src/lib/server/memory-center';

describe('memory center', () => {
	const entries = getMemoryCorpus();

	it('computes corpus stats from durable entries', () => {
		const stats = computeMemoryStats(entries);
		expect(stats.online).toBe(true);
		expect(stats.entries).toBe(entries.length);
		expect(stats.nodes).toBe(entries.length);
		expect(stats.edges).toBeGreaterThan(0);
		expect(stats.decisions + stats.incidents).toBeGreaterThan(0);
	});

	it('builds a graph with typed edges between known ids', () => {
		const graph = buildMemoryGraph(entries);
		expect(graph.nodes.length).toBe(entries.length);
		expect(graph.edges.length).toBeGreaterThan(0);
		const ids = new Set(graph.nodes.map((n) => n.id));
		for (const e of graph.edges) {
			expect(ids.has(e.from)).toBe(true);
			expect(ids.has(e.to)).toBe(true);
			expect(e.type).toBeTruthy();
		}
	});

	it('builds a chronological investigation path around search fallback', () => {
		const path = buildInvestigation('incident-search-fallback-stale', entries);
		expect(path.some((s) => s.id === 'incident-search-fallback-stale')).toBe(true);
		expect(path.some((s) => s.id === 'incident-gharchive-createevent')).toBe(true);
		const dates = path.map((s) => s.date);
		expect([...dates].sort()).toEqual(dates);
	});

	it('runs read-only retrieval for the live panel', () => {
		const result = runMemoryQuery('search fallback', 6000);
		expect(result.stages.candidates).toBeGreaterThan(0);
		expect(result.assembled[0]?.entry.id).toBe('incident-search-fallback-stale');
	});
});
