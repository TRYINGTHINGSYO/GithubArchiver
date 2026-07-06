import './load-env.js';
import { runIngestCycle } from '../src/lib/server/workers/ingest.js';
import { runEnrichCycle } from '../src/lib/server/workers/enrich.js';
import { runRefreshCycle } from '../src/lib/server/workers/refresh.js';
import { runArchiveCycle } from '../src/lib/server/workers/archive.js';
import { getDb } from '../src/lib/server/db/index.js';

getDb();

console.log('[pipeline] ingest…');
const ingest = await runIngestCycle();
console.log('[pipeline] enrich…');
const enrich = await runEnrichCycle();
console.log('[pipeline] refresh…');
const refresh = await runRefreshCycle();
console.log('[pipeline] archive…');
const archive = await runArchiveCycle();

console.log(JSON.stringify({ ingest, enrich, refresh, archive }, null, 2));
