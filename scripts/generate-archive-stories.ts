import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import { runArchiveStoryCycle } from '../src/lib/server/workers/stories.js';

getDb();

const result = await runArchiveStoryCycle({
	maxBatches: Number(process.env.STORY_MAX_BATCHES ?? 0),
	queueOnly: process.env.STORY_QUEUE_ONLY === '1',
	force: process.env.STORY_FORCE === '1'
});

console.log(`Done: ${result.processed} archive stories generated at version ${result.targetVersion}.`);
