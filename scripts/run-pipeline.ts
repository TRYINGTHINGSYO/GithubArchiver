import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import { runArchiveCycle } from '../src/lib/server/workers/archive.js';
import { runClassifyCycle } from '../src/lib/server/workers/classify.js';
import { runClusterCycle } from '../src/lib/server/workers/cluster.js';
import { runDiscoveryMaterializationCycle } from '../src/lib/server/workers/discovery.js';
import { runEmergingTopicCycle } from '../src/lib/server/workers/emerging.js';
import { runEnrichCycle } from '../src/lib/server/workers/enrich.js';
import { runIngestCycle } from '../src/lib/server/workers/ingest.js';
import { runRefreshCycle } from '../src/lib/server/workers/refresh.js';
import { runScoreCycle } from '../src/lib/server/workers/score.js';
import { runArchiveStoryCycle } from '../src/lib/server/workers/stories.js';

getDb();

console.log('[pipeline] ingest…');
const ingest = await runIngestCycle();
console.log('[pipeline] enrich…');
const enrich = await runEnrichCycle();
console.log('[pipeline] refresh…');
const refresh = await runRefreshCycle();
console.log('[pipeline] classify…');
const classify = await runClassifyCycle();
console.log('[pipeline] clusters…');
const clusters = await runClusterCycle();
console.log('[pipeline] score…');
const score = await runScoreCycle();
console.log('[pipeline] stories…');
const stories = await runArchiveStoryCycle();
console.log('[pipeline] emerging…');
const emerging = await runEmergingTopicCycle();
console.log('[pipeline] discovery…');
const discovery = await runDiscoveryMaterializationCycle();
console.log('[pipeline] archive…');
const archive = await runArchiveCycle();

console.log(
	JSON.stringify(
		{ ingest, enrich, refresh, classify, clusters, score, stories, emerging, discovery, archive },
		null,
		2
	)
);
