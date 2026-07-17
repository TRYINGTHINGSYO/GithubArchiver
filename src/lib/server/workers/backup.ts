import { runBackup } from '../backup.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';

export interface BackupCycleResult {
	path: string;
	bytes: number;
}

export async function runBackupCycle(): Promise<BackupCycleResult | null> {
	const jobId = startJobRun('backup', { trigger: 'daemon' });
	try {
		const result = await runBackup();
		finishJobRun(jobId, 'success', {
			dir: result.dir,
			bytes: result.totalBytes,
			type: result.backupType
		});
		return { path: result.dir, bytes: result.totalBytes };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		finishJobRun(jobId, 'failed', {}, message);
		throw err;
	}
}
