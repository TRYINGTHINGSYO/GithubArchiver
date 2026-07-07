import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isIngestCycleFailure, type IngestCycleResult } from '$lib/server/workers/ingest';

describe('ingest cycle status', () => {
	it('treats all-unavailable cycles as success (not failures)', () => {
		const result: IngestCycleResult = {
			hours: 0,
			downloaded: 0,
			unavailable: 6,
			failed: 0,
			events: 0,
			inserted: 0,
			skipped: 0,
			errors: ['2026-07-07-00: unavailable (HTTP 404)']
		};
		expect(isIngestCycleFailure(result)).toBe(false);
	});

	it('treats genuine errors as failures', () => {
		const result: IngestCycleResult = {
			hours: 0,
			downloaded: 0,
			unavailable: 0,
			failed: 1,
			events: 0,
			inserted: 0,
			skipped: 0,
			errors: ['2026-07-06-12: network timeout']
		};
		expect(isIngestCycleFailure(result)).toBe(true);
	});
});
