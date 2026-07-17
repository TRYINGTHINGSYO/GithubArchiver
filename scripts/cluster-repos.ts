import './load-env.js';
import { reapplyRepoClusters } from '../src/lib/server/apply-repo-clusters.js';
import {
	CURRENT_CLUSTER_VERSION,
	ensureClusterRegistry,
	listReposForClustering,
	refreshClusterRepoCounts
} from '../src/lib/server/db/clusters.js';
import {
	getDb,
	getRepoById,
	listPipelineJobs,
	markPipelineDone
} from '../src/lib/server/db/index.js';

const BATCH_SIZE = Number(process.env.CLUSTER_BATCH_SIZE ?? 500);
const MAX_BATCHES = Number(process.env.CLUSTER_MAX_BATCHES ?? 0);
const FORCE = process.env.CLUSTER_FORCE === '1';
const TARGET_VERSION = Number(process.env.CLUSTER_VERSION ?? CURRENT_CLUSTER_VERSION);
const QUEUE_ONLY = process.env.CLUSTER_QUEUE_ONLY === '1';

async function main() {
	getDb();
	ensureClusterRegistry();

	let total = 0;
	let batches = 0;

	// Prefer changed IDs from the enrichment pipeline when present.
	const queued = listPipelineJobs('needsClustering', BATCH_SIZE * Math.max(1, MAX_BATCHES || 4));
	if (queued.length > 0) {
		for (const job of queued) {
			const repo = getRepoById(job.repositoryId);
			if (!repo) {
				markPipelineDone(job.repositoryId, { needsClustering: true });
				continue;
			}
			reapplyRepoClusters(repo, TARGET_VERSION);
			markPipelineDone(job.repositoryId, { needsClustering: true });
			total++;
		}
		console.log(`Clustered ${total} queued repositories at version ${TARGET_VERSION}.`);
	}

	if (QUEUE_ONLY) {
		refreshClusterRepoCounts();
		console.log(`Done (queue-only): ${total} repositories clustered.`);
		return;
	}

	let afterId = 0;
	for (;;) {
		const repos = listReposForClustering(BATCH_SIZE, afterId, TARGET_VERSION, FORCE);
		if (repos.length === 0) break;

		for (const repo of repos) {
			reapplyRepoClusters(repo, TARGET_VERSION);
			markPipelineDone(repo.id, { needsClustering: true });
			afterId = repo.id;
			total++;
		}

		batches++;
		console.log(
			`Clustered ${total} repos (batch ${batches}, version ${TARGET_VERSION}, last id ${afterId})`
		);

		if (MAX_BATCHES > 0 && batches >= MAX_BATCHES) break;
		if (repos.length < BATCH_SIZE) break;
	}

	refreshClusterRepoCounts();
	console.log(`Done: ${total} repositories clustered at version ${TARGET_VERSION}.`);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
