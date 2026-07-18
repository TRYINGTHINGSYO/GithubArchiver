import { describe, expect, it } from 'vitest';
import { formatJobTypeLabel } from '$lib/status-display';

describe('formatJobTypeLabel', () => {
	it('labels the daemon loop distinctly from ingest batches', () => {
		expect(
			formatJobTypeLabel({
				job_type: 'daemon',
				detail_json: JSON.stringify({ phase: 'scheduling' }),
				reason: null
			})
		).toBe('daemon (loop · scheduling)');

		expect(
			formatJobTypeLabel({
				job_type: 'ingest',
				detail_json: JSON.stringify({
					hours_planned: 2,
					parent_daemon_job_id: 821
				}),
				reason: null
			})
		).toBe('ingest batch · daemon #821');

		expect(
			formatJobTypeLabel({
				job_type: 'ingest',
				detail_json: JSON.stringify({
					action: 'search_gap',
					parent_daemon_job_id: 821
				}),
				reason: null
			})
		).toBe('ingest · search fallback · daemon #821');
	});
});
