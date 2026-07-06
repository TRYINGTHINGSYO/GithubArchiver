import { json } from '@sveltejs/kit';
import { finishJobRun, startJobRun } from '$lib/server/db/jobs';
import { runDoctor } from '$lib/server/doctor';
import { runStorageAnalysis } from '$lib/server/storage';
import { isJobRunnerBusy } from '$lib/server/job-runner';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	if (isJobRunnerBusy()) {
		return json({ error: 'Another job is running — wait for it to finish' }, { status: 409 });
	}

	const body = (await request.json()) as {
		action?: string;
		rebuild_fts?: boolean;
		mark_missing_snapshots?: boolean;
		delete_orphans?: boolean;
		delete_duplicates?: boolean;
		trim_old?: boolean;
	};

	const action = body.action ?? '';

	if (action === 'doctor') {
		const jobId = startJobRun('maintenance', { action: 'doctor', ...body });
		try {
			const report = runDoctor({
				repair: Boolean(body.rebuild_fts || body.mark_missing_snapshots),
				rebuildFts: body.rebuild_fts,
				markMissingSnapshots: body.mark_missing_snapshots
			});
			finishJobRun(jobId, report.healthy ? 'success' : 'failed', report);
			return json({ ok: true, jobId, report });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			finishJobRun(jobId, 'failed', {}, message);
			return json({ error: message }, { status: 500 });
		}
	}

	if (action === 'storage') {
		const jobId = startJobRun('maintenance', { action: 'storage', ...body });
		try {
			const report = runStorageAnalysis({
				cleanup: Boolean(body.delete_orphans || body.delete_duplicates || body.trim_old),
				deleteOrphans: body.delete_orphans,
				deleteDuplicates: body.delete_duplicates,
				trimOld: body.trim_old
			});
			finishJobRun(jobId, 'success', report);
			return json({ ok: true, jobId, report });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			finishJobRun(jobId, 'failed', {}, message);
			return json({ error: message }, { status: 500 });
		}
	}

	return json({ error: `Unknown action: ${action}` }, { status: 400 });
};
