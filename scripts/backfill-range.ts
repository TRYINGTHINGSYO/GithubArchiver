import './load-env.js';
import { createBackfillJob, getBackfillJob } from '../src/lib/server/db/backfill.js';
import { runBackfillBatch } from '../src/lib/server/backfill-runner.js';
import { getDb } from '../src/lib/server/db/index.js';

getDb();

const startDate = process.env.BACKFILL_START;
const endDate = process.env.BACKFILL_END;
if (!startDate || !endDate) {
	console.error('BACKFILL_START and BACKFILL_END required (YYYY-MM-DD)');
	process.exit(1);
}

const source = (process.env.BACKFILL_SOURCE ?? 'auto') as 'auto' | 'gharchive' | 'github_search';
const maxHours = Number(process.env.BACKFILL_MAX_HOURS ?? 6);

const jobId = createBackfillJob({ startDate, endDate, source, maxHoursPerRun: maxHours });
console.log(`Backfill job #${jobId} ${startDate} → ${endDate}`);
const result = await runBackfillBatch(jobId);
console.log(JSON.stringify({ job: getBackfillJob(jobId), result }, null, 2));
