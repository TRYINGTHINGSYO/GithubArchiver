import { generateAndSaveArchiveStory } from '../archive-story.js';
import { CURRENT_STORY_VERSION } from '../archive-story-types.js';
import { listReposForStoryGeneration } from '../db/archive-story.js';
import { getRepoById, listPipelineJobs, markPipelineDone } from '../db/index.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';

const BATCH_SIZE = Number(process.env.STORY_BATCH_SIZE ?? 100);
const MAX_BATCHES = Number(process.env.STORY_MAX_BATCHES ?? 1);
const FORCE = process.env.STORY_FORCE === '1';
const TARGET_VERSION = Number(process.env.STORY_VERSION ?? CURRENT_STORY_VERSION);
const QUEUE_ONLY = process.env.STORY_QUEUE_ONLY === '1';

export interface StoryCycleResult {
	processed: number;
	batches: number;
	queued: number;
	targetVersion: number;
}

export async function runArchiveStoryCycle(
	opts: {
		batchSize?: number;
		maxBatches?: number;
		queueOnly?: boolean;
		force?: boolean;
		targetVersion?: number;
	} = {}
): Promise<StoryCycleResult> {
	const batchSize = opts.batchSize ?? BATCH_SIZE;
	const maxBatches = opts.maxBatches ?? MAX_BATCHES;
	const queueOnly = opts.queueOnly ?? QUEUE_ONLY;
	const force = opts.force ?? FORCE;
	const targetVersion = opts.targetVersion ?? TARGET_VERSION;

	const jobId = startJobRun('pipeline', {
		phase: 'stories',
		batch_size: batchSize,
		max_batches: maxBatches,
		target_version: targetVersion,
		queue_only: queueOnly
	});

	const result: StoryCycleResult = {
		processed: 0,
		batches: 0,
		queued: 0,
		targetVersion
	};

	const queued = listPipelineJobs('needsStory', batchSize * Math.max(1, maxBatches || 4));
	for (const job of queued) {
		const repo = getRepoById(job.repositoryId);
		if (!repo) {
			markPipelineDone(job.repositoryId, { needsStory: true });
			continue;
		}
		generateAndSaveArchiveStory(repo, targetVersion);
		markPipelineDone(job.repositoryId, { needsStory: true });
		result.processed++;
		result.queued++;
	}

	if (queueOnly) {
		finishJobRun(jobId, 'success', result);
		return result;
	}

	let afterId = 0;
	for (;;) {
		const repos = listReposForStoryGeneration(batchSize, afterId, targetVersion, force);
		if (repos.length === 0) break;

		for (const repo of repos) {
			generateAndSaveArchiveStory(repo, targetVersion);
			markPipelineDone(repo.id, { needsStory: true });
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
