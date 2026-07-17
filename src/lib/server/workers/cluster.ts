import { reapplyRepoClusters } from '../apply-repo-clusters.js';
import {
	CURRENT_CLUSTER_VERSION,
	ensureClusterRegistry,
	listReposForClustering,
	refreshClusterRepoCounts
} from '../db/clusters.js';
import { getRepoById, listPipelineJobs, markPipelineDone } from '../db/index.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';

const BATCH_SIZE = Number(process.env.CLUSTER_BATCH_SIZE ?? 500);
const MAX_BATCHES = Number(process.env.CLUSTER_MAX_BATCHES ?? 1);
const FORCE = process.env.CLUSTER_FORCE === '1';
const TARGET_VERSION = Number(process.env.CLUSTER_VERSION ?? CURRENT_CLUSTER_VERSION);
const QUEUE_ONLY = process.env.CLUSTER_QUEUE_ONLY === '1';

export interface ClusterCycleResult {
	processed: number;
	batches: number;
	queued: number;
	targetVersion: number;
}

export async function runClusterCycle(
	opts: {
		batchSize?: number;
		maxBatches?: number;
		queueOnly?: boolean;
		force?: boolean;
		targetVersion?: number;
	} = {}
): Promise<ClusterCycleResult> {
	const batchSize = opts.batchSize ?? BATCH_SIZE;
	const maxBatches = opts.maxBatches ?? MAX_BATCHES;
	const queueOnly = opts.queueOnly ?? QUEUE_ONLY;
	const force = opts.force ?? FORCE;
	const targetVersion = opts.targetVersion ?? TARGET_VERSION;

	ensureClusterRegistry();

	const jobId = startJobRun('pipeline', {
		phase: 'cluster',
		batch_size: batchSize,
		max_batches: maxBatches,
		target_version: targetVersion,
		queue_only: queueOnly
	});

	const result: ClusterCycleResult = {
		processed: 0,
		batches: 0,
		queued: 0,
		targetVersion
	};

	const queued = listPipelineJobs('needsClustering', batchSize * Math.max(1, maxBatches || 4));
	for (const job of queued) {
		const repo = getRepoById(job.repositoryId);
		if (!repo) {
			markPipelineDone(job.repositoryId, { needsClustering: true });
			continue;
		}
		reapplyRepoClusters(repo, targetVersion);
		markPipelineDone(job.repositoryId, { needsClustering: true });
		result.processed++;
		result.queued++;
	}

	if (queueOnly) {
		refreshClusterRepoCounts();
		finishJobRun(jobId, 'success', result);
		return result;
	}

	let afterId = 0;
	for (;;) {
		const repos = listReposForClustering(batchSize, afterId, targetVersion, force);
		if (repos.length === 0) break;

		for (const repo of repos) {
			reapplyRepoClusters(repo, targetVersion);
			markPipelineDone(repo.id, { needsClustering: true });
			afterId = repo.id;
			result.processed++;
		}

		result.batches++;
		if (maxBatches > 0 && result.batches >= maxBatches) break;
		if (repos.length < batchSize) break;
	}

	refreshClusterRepoCounts();
	finishJobRun(jobId, 'success', result);
	return result;
}
