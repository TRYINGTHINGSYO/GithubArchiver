import './load-env.js';
import { generateAndSaveArchiveStory } from '../src/lib/server/archive-story.js';
import { CURRENT_STORY_VERSION } from '../src/lib/server/archive-story-types.js';
import { listReposForStoryGeneration } from '../src/lib/server/db/archive-story.js';
import {
	getDb,
	getRepoById,
	listPipelineJobs,
	markPipelineDone
} from '../src/lib/server/db/index.js';

const BATCH_SIZE = Number(process.env.STORY_BATCH_SIZE ?? 500);
const MAX_BATCHES = Number(process.env.STORY_MAX_BATCHES ?? 0);
const FORCE = process.env.STORY_FORCE === '1';
const TARGET_VERSION = Number(process.env.STORY_VERSION ?? CURRENT_STORY_VERSION);
const QUEUE_ONLY = process.env.STORY_QUEUE_ONLY === '1';

async function main() {
	getDb();

	let total = 0;
	let batches = 0;

	const queued = listPipelineJobs('needsStory', BATCH_SIZE * Math.max(1, MAX_BATCHES || 4));
	if (queued.length > 0) {
		for (const job of queued) {
			const repo = getRepoById(job.repositoryId);
			if (!repo) {
				markPipelineDone(job.repositoryId, { needsStory: true });
				continue;
			}
			generateAndSaveArchiveStory(repo, TARGET_VERSION);
			markPipelineDone(job.repositoryId, { needsStory: true });
			total++;
		}
		console.log(`Generated ${total} queued archive stories at version ${TARGET_VERSION}.`);
	}

	if (QUEUE_ONLY) {
		console.log(`Done (queue-only): ${total} archive stories generated.`);
		return;
	}

	let afterId = 0;
	for (;;) {
		const repos = listReposForStoryGeneration(BATCH_SIZE, afterId, TARGET_VERSION, FORCE);
		if (repos.length === 0) break;

		for (const repo of repos) {
			generateAndSaveArchiveStory(repo, TARGET_VERSION);
			markPipelineDone(repo.id, { needsStory: true });
			afterId = repo.id;
			total++;
		}

		batches++;
		console.log(
			`Generated ${total} archive stories (batch ${batches}, version ${TARGET_VERSION}, last id ${afterId})`
		);

		if (MAX_BATCHES > 0 && batches >= MAX_BATCHES) break;
		if (repos.length < BATCH_SIZE) break;
	}

	console.log(`Done: ${total} archive stories generated at version ${TARGET_VERSION}.`);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
