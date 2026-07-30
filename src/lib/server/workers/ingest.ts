import { formatIngestLine, ingestHour, ingestSourceForRecord, isIngestSuccess } from '$ingest-core';
import {
	finishJobRun,
	listMissingHourKeys,
	recordHourIngested,
	recordHourUnavailable,
	startJobRun,
	updateJobRun
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
	/** True when the cycle stopped early due to INGEST_WALL_CLOCK_MS. */
	wallClockExceeded?: boolean;
}

/** Whole-cycle ceiling (default 10 min). Env: INGEST_WALL_CLOCK_MS. */
export function ingestWallClockMs(): number {
	const n = Number(process.env.INGEST_WALL_CLOCK_MS ?? 10 * 60_000);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10 * 60_000;
}

function emptyResult(): IngestCycleResult {
	return {
		hours: 0,
		downloaded: 0,
		unavailable: 0,
		failed: 0,
		events: 0,
		inserted: 0,
		skipped: 0,
		errors: []
	};
}

function heartbeat(
	jobId: number,
	detail: Record<string, unknown>
): void {
	updateJobRun(jobId, {
		...detail,
		heartbeat_at: new Date().toISOString()
	});
}

/**
 * Ingest up to DAEMON_INGEST_MAX_HOURS missing GH Archive hours.
 * Always finishes the job_run (success/failed) — timeouts and unexpected throws
 * must not leave rows stuck in `running`.
 */
export async function runIngestCycle(opts?: {
	/** Test hook: fixed "now" for wall-clock deadline. */
	nowMs?: number;
	/** Test hook: override wall-clock budget. */
	wallClockMs?: number;
}): Promise<IngestCycleResult> {
	const missing = listMissingHourKeys();
	const jobId = startJobRun('ingest', { hours_planned: missing.length });
	const result = emptyResult();
	const wallClockMs = opts?.wallClockMs ?? ingestWallClockMs();
	const nowMs = opts?.nowMs ?? Date.now();
	const deadline = nowMs + wallClockMs;
	let finished = false;

	const finish = (status: 'success' | 'failed', error?: string) => {
		if (finished) return;
		finished = true;
		finishJobRun(jobId, status, result, error);
	};

	try {
		if (missing.length === 0) {
			finish('success');
			return { ...result };
		}

		for (const hourKey of missing) {
			if (Date.now() >= deadline) {
				result.wallClockExceeded = true;
				result.failed++;
				result.errors.push(
					`wall-clock limit exceeded (${wallClockMs}ms) before hour ${hourKey}`
				);
				console.warn(`[ingest] wall-clock exceeded before hour ${hourKey}`);
				break;
			}

			console.log(`[ingest] starting hour ${hourKey}`);
			heartbeat(jobId, {
				hours_planned: missing.length,
				current_hour: hourKey,
				phase: 'starting',
				...summarize(result)
			});

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

			console.log(`[ingest] completed hour ${hourKey} (${hour.outcome})`);
			heartbeat(jobId, {
				hours_planned: missing.length,
				current_hour: hourKey,
				phase: 'completed',
				last_outcome: hour.outcome,
				...summarize(result)
			});
		}

		const status = result.failed > 0 ? 'failed' : 'success';
		finish(status, result.failed > 0 ? result.errors.join('; ') : undefined);
		return result;
	} catch (err) {
		// Catch-and-mark-failed: never leave job_runs stuck in `running`.
		const message = err instanceof Error ? err.message : String(err);
		result.failed++;
		result.errors.push(message);
		console.error(`[ingest] cycle aborted: ${message}`);
		finish('failed', message);
		return result;
	} finally {
		if (!finished) {
			finish('failed', 'ingest cycle exited without finishing job_run');
		}
	}
}

function summarize(result: IngestCycleResult): Record<string, unknown> {
	return {
		downloaded: result.downloaded,
		unavailable: result.unavailable,
		failed: result.failed,
		inserted: result.inserted,
		events: result.events
	};
}

/** True only for genuine ingest errors — unavailable hours are expected, not failures. */
export function isIngestCycleFailure(result: IngestCycleResult): boolean {
	return result.failed > 0;
}
