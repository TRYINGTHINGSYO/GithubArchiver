import './load-env.js';
import { getDb, getRepoById, listEnrichedReposForReclassification } from '../src/lib/server/db/index.js';
import {
	listPipelineJobs,
	markPipelineDone
} from '../src/lib/server/db/pipeline.js';
import { reapplyRepoIntelligence } from '../src/lib/server/apply-repo-intelligence.js';

const BATCH_SIZE = Number(process.env.RECLASSIFY_BATCH_SIZE ?? 500);
const MAX_BATCHES = Number(process.env.RECLASSIFY_MAX_BATCHES ?? 0);
const QUEUE_ONLY = process.env.RECLASSIFY_QUEUE_ONLY === '1';

async function main() {
	getDb();

	let total = 0;
	let batches = 0;

	const queued = listPipelineJobs('needsClassification', BATCH_SIZE * Math.max(1, MAX_BATCHES || 4));
	if (queued.length > 0) {
		for (const job of queued) {
			const repo = getRepoById(job.repositoryId);
			if (!repo) {
				markPipelineDone(job.repositoryId, { needsClassification: true, needsScoring: true });
				continue;
			}
			reapplyRepoIntelligence(repo);
			markPipelineDone(job.repositoryId, { needsClassification: true, needsScoring: true });
			total++;
		}
		console.log(`Reclassified ${total} queued repositories.`);
	}

	if (QUEUE_ONLY) {
		console.log(`Done (queue-only): ${total} repositories reclassified.`);
		return;
	}

	let afterId = 0;
	for (;;) {
		const repos = listEnrichedReposForReclassification(BATCH_SIZE, afterId);
		if (repos.length === 0) break;

		for (const repo of repos) {
			reapplyRepoIntelligence(repo);
			markPipelineDone(repo.id, { needsClassification: true, needsScoring: true });
			afterId = repo.id;
			total++;
		}

		batches++;
		console.log(`Reclassified ${total} repos (batch ${batches}, last id ${afterId})`);

		if (MAX_BATCHES > 0 && batches >= MAX_BATCHES) break;
		if (repos.length < BATCH_SIZE) break;
	}

	console.log(`Done: ${total} repositories reclassified.`);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
