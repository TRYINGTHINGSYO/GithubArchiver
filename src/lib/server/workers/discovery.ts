import { materializeDiscoveryResults } from '../discovery-materialized.js';
import type { DiscoverySectionRowCounts } from '../discovery-materialization.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';

export interface DiscoveryMaterializationResult {
	status: 'success' | 'skipped_deduped' | 'failed';
	runId: number | null;
	qualified: number;
	preliminary: number;
	rowCounts: DiscoverySectionRowCounts;
	error?: string;
}

export async function runDiscoveryMaterializationCycle(
	opts: { owner?: string } = {}
): Promise<DiscoveryMaterializationResult> {
	const jobId = startJobRun('pipeline', {
		phase: 'discovery_materialize',
		owner: opts.owner ?? null
	});
	try {
		const result = materializeDiscoveryResults({
			limit: 50,
			minScore: 55,
			owner: opts.owner ?? `worker-${process.pid}`
		});
		if (result.status === 'failed') {
			finishJobRun(jobId, 'failed', result, result.error);
			return result;
		}
		finishJobRun(jobId, 'success', result);
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		finishJobRun(jobId, 'failed', {}, message);
		throw err;
	}
}
