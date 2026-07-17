import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import { runClusterCycle } from '../src/lib/server/workers/cluster.js';

getDb();

const result = await runClusterCycle({
	maxBatches: Number(process.env.CLUSTER_MAX_BATCHES ?? 0),
	queueOnly: process.env.CLUSTER_QUEUE_ONLY === '1',
	force: process.env.CLUSTER_FORCE === '1'
});

console.log(`Done: ${result.processed} repositories clustered at version ${result.targetVersion}.`);
