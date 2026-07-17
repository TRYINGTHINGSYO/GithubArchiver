import { materializeDiscoveryResults } from '../discovery-materialized.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';

export interface DiscoveryMaterializationResult {
	qualified: number;
	preliminary: number;
}

export async function runDiscoveryMaterializationCycle(): Promise<DiscoveryMaterializationResult> {
	const jobId = startJobRun('pipeline', { phase: 'discovery_materialize' });
	const result = materializeDiscoveryResults({ limit: 50, minScore: 55 });
	finishJobRun(jobId, 'success', result);
	return result;
}
