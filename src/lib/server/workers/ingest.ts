import { formatIngestLine, ingestHour, ingestSourceForRecord, isIngestSuccess } from '../../../scripts/lib/ingest-core.js';

import {

	finishJobRun,

	listMissingHourKeys,

	recordHourIngested,

	startJobRun

} from '../db/index.js';



export interface IngestCycleResult {

	hours: number;

	downloaded: number;

	unavailable: number;

	failed: number;

	events: number;

	inserted: number;

	skipped: number;

	errors: string[];

}



export async function runIngestCycle(): Promise<IngestCycleResult> {

	const missing = listMissingHourKeys();

	const jobId = startJobRun('ingest', { hours_planned: missing.length });



	const result: IngestCycleResult = {

		hours: 0,

		downloaded: 0,

		unavailable: 0,

		failed: 0,

		events: 0,

		inserted: 0,

		skipped: 0,

		errors: []

	};



	if (missing.length === 0) {

		finishJobRun(jobId, 'success', { ...result, message: 'no missing hours' });

		return result;

	}



	for (const hourKey of missing) {

		const hour = await ingestHour(hourKey);

		console.log(formatIngestLine(hour));



		if (isIngestSuccess(hour)) {
			recordHourIngested(hourKey, {
				events: hour.repoCreates + (hour.searchFound ?? 0),
				inserted: hour.inserted,
				skipped: hour.skipped,
				source: ingestSourceForRecord(hour)
			});
			result.hours++;
			result.downloaded++;
			result.events += hour.repoCreates + (hour.searchFound ?? 0);

			result.inserted += hour.inserted;

			result.skipped += hour.skipped;

		} else if (hour.outcome === 'unavailable') {

			result.unavailable++;

			result.errors.push(`${hourKey}: unavailable (HTTP ${hour.httpStatus ?? '?'})`);

		} else {

			result.failed++;

			result.errors.push(`${hourKey}: ${hour.error ?? 'failed'}`);

		}

	}



	const status = result.failed > 0 && result.downloaded === 0 ? 'failed' : 'success';

	finishJobRun(jobId, status, result, result.errors.join('; ') || undefined);

	return result;

}

