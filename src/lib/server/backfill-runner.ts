import {
	completeBackfillHour,
	getActiveBackfillJob,
	getBackfillJob,
	getBackfillProgress,
	listPendingBackfillHours,
	markBackfillHourRunning,
	resetRunningBackfillHours,
	refreshBackfillJobStatus,
	updateBackfillJob,
	type BackfillSource
} from './db/backfill.js';
import { recordHourIngested } from './db/ingestion.js';
import { ingestReposFromSearch } from './repo-discovery.js';
import {
	archiveUrlForKey,
	streamRepositoryCreates
} from './gharchive.js';
import {
	ingestHour,
	ingestSourceForRecord,
	isIngestSuccess
} from '../../scripts/lib/ingest-core.js';
import { insertRepo } from './db/repos.js';
import { appendRepoEvent } from './events.js';

export interface BackfillRunResult {
	jobId: number;
	processed: number;
	completed: number;
	failed: number;
	unavailable: number;
	errors: string[];
}

async function ingestSearchOnly(hourKey: string) {
	const search = await ingestReposFromSearch(hourKey);
	return {
		source: 'github_search' as const,
		eventsParsed: search.found,
		reposInserted: search.inserted,
		error: undefined as string | undefined
	};
}

async function ingestGhArchiveOnly(hourKey: string) {
	const url = archiveUrlForKey(hourKey);
	const firstSeenAt = new Date().toISOString();
	let inserted = 0;
	let skipped = 0;
	const stats = await streamRepositoryCreates(url, async (event) => {
		const result = insertRepo({ ...event, first_seen_at: firstSeenAt, discovery_source: 'gharchive' });
		if (result.status === 'inserted' && result.id) {
			inserted++;
			appendRepoEvent(result.id, 'first_seen', {
				full_name: event.full_name,
				github_url: event.github_url,
				event_id: event.event_id,
				created_at: event.created_at,
				discovery_source: 'gharchive'
			}, firstSeenAt);
		} else {
			skipped++;
		}
	});
	return {
		source: 'gharchive' as const,
		eventsParsed: stats.parsedEvents,
		reposInserted: inserted,
		skipped,
		repoCreates: stats.repoCreates
	};
}

async function ingestHourForBackfill(hourKey: string, source: BackfillSource) {
	if (source === 'github_search') {
		const r = await ingestSearchOnly(hourKey);
		return { outcome: 'downloaded' as const, ...r, skipped: 0 };
	}
	if (source === 'gharchive') {
		try {
			const r = await ingestGhArchiveOnly(hourKey);
			return { outcome: 'downloaded' as const, source: r.source, eventsParsed: r.eventsParsed, reposInserted: r.reposInserted };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes('unavailable') || message.includes('404')) {
				return { outcome: 'unavailable' as const, error: message, eventsParsed: 0, reposInserted: 0, source: 'gharchive' as const };
			}
			return { outcome: 'failed' as const, error: message, eventsParsed: 0, reposInserted: 0, source: 'gharchive' as const };
		}
	}

	const result = await ingestHour(hourKey);
	if (isIngestSuccess(result)) {
		recordHourIngested(hourKey, {
			events: result.parsedEvents + (result.searchFound ?? 0),
			inserted: result.inserted,
			skipped: result.skipped,
			source: ingestSourceForRecord(result)
		});
		return {
			outcome: 'downloaded' as const,
			source: ingestSourceForRecord(result) as string,
			eventsParsed: result.parsedEvents,
			reposInserted: result.inserted
		};
	}
	if (result.outcome === 'unavailable') {
		return { outcome: 'unavailable' as const, error: result.error, eventsParsed: 0, reposInserted: 0, source: 'gharchive' as const };
	}
	return { outcome: 'failed' as const, error: result.error, eventsParsed: 0, reposInserted: 0, source: 'gharchive' as const };
}

export async function runBackfillBatch(jobId?: number): Promise<BackfillRunResult> {
	const job = jobId ? getBackfillJob(jobId) : getActiveBackfillJob();
	if (!job) {
		throw new Error('No active backfill job');
	}

	updateBackfillJob(job.id, { status: 'running' });
	resetRunningBackfillHours(job.id);
	const hours = listPendingBackfillHours(job.id, job.max_hours_per_run);
	const result: BackfillRunResult = {
		jobId: job.id,
		processed: 0,
		completed: 0,
		failed: 0,
		unavailable: 0,
		errors: []
	};

	for (const hour of hours) {
		markBackfillHourRunning(hour.id);
		try {
			const ingest = await ingestHourForBackfill(hour.hour_key, job.source as BackfillSource);
			result.processed++;

			if (ingest.outcome === 'downloaded') {
				completeBackfillHour(hour.id, {
					status: 'completed',
					source: ingest.source,
					eventsParsed: ingest.eventsParsed,
					reposInserted: ingest.reposInserted
				});
				if (job.source === 'auto') {
					// auto path records via ingestHour
				} else {
					recordHourIngested(hour.hour_key, {
						events: ingest.eventsParsed,
						inserted: ingest.reposInserted,
						skipped: 0,
						source: ingest.source
					});
				}
				result.completed++;
			} else if (ingest.outcome === 'unavailable') {
				completeBackfillHour(hour.id, {
					status: 'unavailable',
					error: ingest.error
				});
				result.unavailable++;
			} else {
				completeBackfillHour(hour.id, {
					status: 'failed',
					error: ingest.error
				});
				result.failed++;
				if (ingest.error) result.errors.push(`${hour.hour_key}: ${ingest.error}`);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			completeBackfillHour(hour.id, { status: 'failed', error: message });
			result.failed++;
			result.errors.push(`${hour.hour_key}: ${message}`);
		}
	}

	refreshBackfillJobStatus(job.id);
	const progress = getBackfillProgress(job.id);
	if (progress.pending === 0 && progress.running === 0) {
		updateBackfillJob(job.id, {
			status: progress.failed > 0 ? 'failed' : 'completed',
			last_error: result.errors[0] ?? null
		});
	}

	return result;
}
