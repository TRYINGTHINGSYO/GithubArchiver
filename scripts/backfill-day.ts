import './load-env.js';
import { createBackfillJob, getBackfillJob } from '../src/lib/server/db/backfill.js';
import { runBackfillBatch } from '../src/lib/server/backfill-runner.js';
import { getDb } from '../src/lib/server/db/index.js';

getDb();

const day = process.env.BACKFILL_DAY ?? new Date().toISOString().slice(0, 10);
const source = (process.env.BACKFILL_SOURCE ?? 'auto') as 'auto' | 'gharchive' | 'github_search';
const maxHours = Number(process.env.BACKFILL_MAX_HOURS ?? 24);

const jobId = createBackfillJob({
	startDate: day,
	endDate: day,
	source,
	maxHoursPerRun: maxHours
});

console.log(`Backfill job #${jobId} for ${day}`);
const result = await runBackfillBatch(jobId);
console.log(JSON.stringify({ job: getBackfillJob(jobId), result }, null, 2));
