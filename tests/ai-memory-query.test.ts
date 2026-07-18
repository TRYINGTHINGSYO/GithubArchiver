import { describe, expect, it } from 'vitest';
import { loadMemoryEntries, queryMemory } from '../scripts/lib/ai-memory';

describe('ai memory query', () => {
	const entries = loadMemoryEntries();

	it('requires stable ids on every entry', () => {
		for (const e of entries) {
			expect(e.id).toBeTruthy();
			expect(e.confidence).toMatch(/^(confirmed|hypothesis|deprecated)$/);
		}
	});

	it('retrieves search-fallback cluster via graph traversal', () => {
		const hits = queryMemory(entries, 'search fallback', { depth: 2, limit: 12 });
		const ids = hits.map((h) => h.entry.id);
		expect(ids).toContain('incident-search-fallback-stale');
		expect(ids).toContain('incident-gharchive-createevent');
		// migration edge and/or debt should be reachable
		expect(
			ids.some((id) => id === 'incident-gharchive-createevent' || id.includes('createevent'))
		).toBe(true);
		expect(hits.some((h) => h.entry.migration === 30 || h.entry.related.includes('migration-030'))).toBe(
			true
		);
	});

	it('can resolve by stable id', () => {
		const hits = queryMemory(entries, 'incident-gharchive-createevent', { depth: 1 });
		expect(hits[0]?.entry.id).toBe('incident-gharchive-createevent');
		expect(hits[0]?.entry.confidence).toBe('confirmed');
	});
});
