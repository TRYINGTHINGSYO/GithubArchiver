import './load-env.js';
import { getActiveBackfillJob, getBackfillJob } from '../src/lib/server/db/backfill.js';
import { runBackfillBatch } from '../src/lib/server/backfill-runner.js';
import { getDb } from '../src/lib/server/db/index.js';

getDb();

const jobId = Number(process.env.BACKFILL_JOB_ID ?? 0) || getActiveBackfillJob()?.id;
if (!jobId) {
	console.error('No active backfill job. Create one with backfill:day or backfill:range.');
	process.exit(1);
}

let batches = 0;
while (true) {
	const job = getBackfillJob(jobId);
	if (!job || job.status === 'completed' || job.status === 'failed') {
		break;
	}

	const result = await runBackfillBatch(jobId);
	batches++;
	console.log(JSON.stringify({ batch: batches, job: getBackfillJob(jobId), result }, null, 2));

	if (result.processed === 0) {
		break;
	}

	const progress = getBackfillJob(jobId);
	if (progress?.status === 'completed' || progress?.status === 'failed') {
		break;
	}
}

console.log(`Backfill worker finished after ${batches} batch(es).`);
