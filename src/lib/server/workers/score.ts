import { reapplyRepoIntelligence } from '../apply-repo-intelligence.js';
import { refreshClusterRepoCounts } from '../db/clusters.js';
import { getRepoById, listPipelineJobs, markPipelineDone } from '../db/index.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';

const BATCH_SIZE = Number(process.env.SCORE_BATCH_SIZE ?? 200);

export interface ScoreCycleResult {
	scored: number;
	clusterCountsRefreshed: boolean;
}

/**
 * Re-score queued repositories and refresh cluster growth aggregates.
 */
export async function runScoreCycle(
	opts: { batchSize?: number } = {}
): Promise<ScoreCycleResult> {
	const batchSize = opts.batchSize ?? BATCH_SIZE;
	const jobId = startJobRun('pipeline', { phase: 'score', batch_size: batchSize });

	const result: ScoreCycleResult = { scored: 0, clusterCountsRefreshed: false };
	const queued = listPipelineJobs('needsScoring', batchSize);

	for (const job of queued) {
		const repo = getRepoById(job.repositoryId);
		if (!repo) {
			markPipelineDone(job.repositoryId, { needsScoring: true });
			continue;
		}
		reapplyRepoIntelligence(repo);
		markPipelineDone(job.repositoryId, { needsScoring: true });
		result.scored++;
	}

	refreshClusterRepoCounts();
	result.clusterCountsRefreshed = true;

	finishJobRun(jobId, 'success', result);
	return result;
}
