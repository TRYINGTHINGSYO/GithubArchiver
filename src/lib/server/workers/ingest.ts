import { formatIngestLine, ingestHour, ingestSourceForRecord, isIngestSuccess } from '$ingest-core';

import {

	finishJobRun,

	listMissingHourKeys,

	recordHourIngested,
	recordHourUnavailable,

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
				matchedRepoCreates: hour.repoCreates,
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
			if (hour.httpStatus != null) {
				recordHourUnavailable(hourKey, hour.httpStatus);
			}

		} else {

			result.failed++;

			result.errors.push(`${hourKey}: ${hour.error ?? 'failed'}`);

		}

	}



	const status = result.failed > 0 ? 'failed' : 'success';

	finishJobRun(jobId, status, result, result.failed > 0 ? result.errors.join('; ') : undefined);

	return result;
}

/** True only for genuine ingest errors — unavailable hours are expected, not failures. */
export function isIngestCycleFailure(result: IngestCycleResult): boolean {
	return result.failed > 0;
}

