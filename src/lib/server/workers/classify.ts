import { reapplyRepoIntelligence } from '../apply-repo-intelligence.js';
import {
	getRepoById,
	listEnrichedReposForReclassification,
	listPipelineJobs,
	markPipelineDone
} from '../db/index.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';

const BATCH_SIZE = Number(process.env.RECLASSIFY_BATCH_SIZE ?? 500);
const MAX_BATCHES = Number(process.env.RECLASSIFY_MAX_BATCHES ?? 1);
const QUEUE_ONLY = process.env.RECLASSIFY_QUEUE_ONLY === '1';

export interface ClassifyCycleResult {
	processed: number;
	batches: number;
	queued: number;
}

export async function runClassifyCycle(
	opts: { batchSize?: number; maxBatches?: number; queueOnly?: boolean } = {}
): Promise<ClassifyCycleResult> {
	const batchSize = opts.batchSize ?? BATCH_SIZE;
	const maxBatches = opts.maxBatches ?? MAX_BATCHES;
	const queueOnly = opts.queueOnly ?? QUEUE_ONLY;

	const jobId = startJobRun('pipeline', {
		phase: 'classify',
		batch_size: batchSize,
		max_batches: maxBatches,
		queue_only: queueOnly
	});

	const result: ClassifyCycleResult = { processed: 0, batches: 0, queued: 0 };

	const queued = listPipelineJobs('needsClassification', batchSize * Math.max(1, maxBatches || 4));
	for (const job of queued) {
		const repo = getRepoById(job.repositoryId);
		if (!repo) {
			markPipelineDone(job.repositoryId, { needsClassification: true, needsScoring: true });
			continue;
		}
		reapplyRepoIntelligence(repo);
		markPipelineDone(job.repositoryId, { needsClassification: true, needsScoring: true });
		result.processed++;
		result.queued++;
	}

	if (queueOnly) {
		finishJobRun(jobId, 'success', result);
		return result;
	}

	let afterId = 0;
	for (;;) {
		const repos = listEnrichedReposForReclassification(batchSize, afterId);
		if (repos.length === 0) break;

		for (const repo of repos) {
			reapplyRepoIntelligence(repo);
			markPipelineDone(repo.id, { needsClassification: true, needsScoring: true });
			afterId = repo.id;
			result.processed++;
		}

		result.batches++;
		if (maxBatches > 0 && result.batches >= maxBatches) break;
		if (repos.length < batchSize) break;
	}

	finishJobRun(jobId, 'success', result);
	return result;
}
