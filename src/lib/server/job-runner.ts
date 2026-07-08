import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ingestHour } from '$ingest-core';
import { runBackfillBatch } from './backfill-runner';
import { runBackup, type BackupOptions } from './backup';
import { runBulkExport, type BulkExportScope } from './bulk-export';
import { getActiveBackfillJob, getBackfillJob } from './db/backfill';
import { finishJobRun, getRunningJobByType, startJobRun, updateJobRun } from './db/jobs';
import { defaultHourKey } from './gharchive';
import { ingestReposFromSearch } from './repo-discovery';
import { runArchiveCycle } from './workers/archive';
import { runEnrichCycle } from './workers/enrich';
import { runIngestCycle } from './workers/ingest';
import { runRefreshCycle } from './workers/refresh';
import { isMetadataOnlyMode } from './runtime-mode';

const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
const LOG_FILE = join(DATA_DIR, 'worker.log');

let queue: Promise<void> = Promise.resolve();
let currentLabel: string | null = null;

function ensureDataDir() {
	mkdirSync(DATA_DIR, { recursive: true });
}

function appendLog(line: string) {
	ensureDataDir();
	appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
}

export function isJobRunnerBusy(): boolean {
	return currentLabel !== null;
}

export function getCurrentJobLabel(): string | null {
	return currentLabel;
}

export interface EnqueueResult {
	queued: boolean;
	message: string;
}

function enqueue(label: string, task: () => Promise<void>): EnqueueResult {
	if (currentLabel) {
		return { queued: false, message: `Busy with "${currentLabel}" — wait for it to finish` };
	}

	queue = queue
		.then(async () => {
			currentLabel = label;
			appendLog(`starting ${label}`);
			try {
				await task();
				appendLog(`finished ${label}`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				appendLog(`failed ${label}: ${msg}`);
				throw err;
			} finally {
				currentLabel = null;
			}
		})
		.catch(() => {
			// keep queue alive
		});

	return { queued: true, message: `${label} started` };
}

export function runPipelineJob(): EnqueueResult {
	return enqueue('pipeline', async () => {
		const jobId = startJobRun('pipeline', {});
		try {
			const ingest = await runIngestCycle();
			const enrich = await runEnrichCycle();
			const refresh = await runRefreshCycle();
			const archive = await runArchiveCycle();
			finishJobRun(jobId, 'success', { ingest, enrich, refresh, archive });
		} catch (err) {
			finishJobRun(
				jobId,
				'failed',
				{},
				err instanceof Error ? err.message : String(err)
			);
			throw err;
		}
	});
}

export function runIngestMissingJob(): EnqueueResult {
	return enqueue('ingest-missing', async () => {
		await runIngestCycle();
	});
}

export function runIngestHourJob(hourKey?: string): EnqueueResult {
	const hour = hourKey ?? defaultHourKey();
	return enqueue(`ingest-hour:${hour}`, async () => {
		const jobId = startJobRun('ingest', { mode: 'single_hour', hourKey: hour });
		try {
			const result = await ingestHour(hour);
			const status = result.outcome === 'failed' ? 'failed' : 'success';
			finishJobRun(jobId, status, result, result.error);
			if (status === 'failed') throw new Error(result.error ?? 'ingest failed');
		} catch (err) {
			if (err instanceof Error && err.message) {
				finishJobRun(jobId, 'failed', {}, err.message);
			}
			throw err;
		}
	});
}

export function runSearchIngestJob(hourKey?: string): EnqueueResult {
	const hour = hourKey ?? defaultHourKey();
	return enqueue(`search-ingest:${hour}`, async () => {
		const jobId = startJobRun('ingest', { mode: 'search', hourKey: hour });
		try {
			const result = await ingestReposFromSearch(hour);
			finishJobRun(jobId, 'success', result);
		} catch (err) {
			finishJobRun(
				jobId,
				'failed',
				{ hourKey: hour },
				err instanceof Error ? err.message : String(err)
			);
			throw err;
		}
	});
}

export function runEnrichJob(): EnqueueResult {
	return enqueue('enrich', async () => {
		await runEnrichCycle();
	});
}

export function runRefreshJob(): EnqueueResult {
	return enqueue('refresh', async () => {
		await runRefreshCycle();
	});
}

export function runArchiveJob(): EnqueueResult {
	return enqueue('archive', async () => {
		await runArchiveCycle();
	});
}

export function runBackupJob(opts: BackupOptions = {}): EnqueueResult {
	return enqueue('backup', async () => {
		const jobId = startJobRun('backup', opts);
		try {
			const result = await runBackup(opts);
			finishJobRun(jobId, 'success', result);
		} catch (err) {
			finishJobRun(
				jobId,
				'failed',
				opts,
				err instanceof Error ? err.message : String(err)
			);
			throw err;
		}
	});
}

export function runBackfillResumeJob(jobId?: number): EnqueueResult {
	const id = jobId ?? getActiveBackfillJob()?.id;
	if (!id) {
		return { queued: false, message: 'No active backfill job to resume' };
	}

	return enqueue(`backfill:${id}`, async () => {
		const runJobId = startJobRun('backfill', { backfill_job_id: id });
		let batches = 0;
		try {
			while (true) {
				const job = getBackfillJob(id);
				if (!job || job.status === 'completed' || job.status === 'failed') break;

				const result = await runBackfillBatch(id);
				batches++;
				appendLog(`backfill batch ${batches}: processed ${result.processed}`);

				if (result.processed === 0) break;
				const progress = getBackfillJob(id);
				if (progress?.status === 'completed' || progress?.status === 'failed') break;
			}
			const finalJob = getBackfillJob(id);
			finishJobRun(runJobId, 'success', { batches, status: finalJob?.status });
		} catch (err) {
			finishJobRun(
				runJobId,
				'failed',
				{ batches },
				err instanceof Error ? err.message : String(err)
			);
			throw err;
		}
	});
}

export function startBulkExportJob(
	scope: BulkExportScope,
	format: 'zip' = 'zip'
): { queued: boolean; jobId?: number; message: string } {
	if (isMetadataOnlyMode()) {
		return { queued: false, message: 'Bulk ZIP export is disabled in metadata-only mode' };
	}

	if (format !== 'zip') {
		return { queued: false, message: 'Only zip format is supported' };
	}

	const running = getRunningJobByType('export');
	if (running) {
		return {
			queued: false,
			message: `Export job #${running.id} is already running`
		};
	}

	if (isJobRunnerBusy()) {
		return {
			queued: false,
			message: `Busy with "${currentLabel}" — wait for it to finish`
		};
	}

	const jobId = startJobRun('export', { scope, format, phase: 'queued' });
	const enqueueResult = enqueue(`export:${scope}`, async () => {
		updateJobRun(jobId, { scope, format, phase: 'building' });
		try {
			const result = await runBulkExport({ scope, jobId, format });
			finishJobRun(jobId, 'success', {
				scope,
				format,
				zip_path: result.zip_path,
				zip_bytes: result.zip_bytes,
				repo_count: result.repo_count,
				snapshot_count: result.snapshot_count,
				skipped_missing_files: result.skipped_missing_files,
				download_url: `/api/export/bulk/${jobId}/download`
			});
		} catch (err) {
			finishJobRun(
				jobId,
				'failed',
				{ scope, format },
				err instanceof Error ? err.message : String(err)
			);
			throw err;
		}
	});

	if (!enqueueResult.queued) {
		finishJobRun(jobId, 'failed', { scope, format }, enqueueResult.message);
		return { queued: false, message: enqueueResult.message };
	}

	return { queued: true, jobId, message: `Bulk export (${scope}) started` };
}
