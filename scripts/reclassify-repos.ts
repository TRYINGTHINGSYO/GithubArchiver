import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import { runClassifyCycle } from '../src/lib/server/workers/classify.js';

getDb();

const result = await runClassifyCycle({
	maxBatches: Number(process.env.RECLASSIFY_MAX_BATCHES ?? 0),
	queueOnly: process.env.RECLASSIFY_QUEUE_ONLY === '1'
});

console.log(`Done: ${result.processed} repositories reclassified.`);
