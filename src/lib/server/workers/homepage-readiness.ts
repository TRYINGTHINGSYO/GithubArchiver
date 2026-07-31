import { materializeHomepageReadiness } from '../homepage-readiness-materialized.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';

export async function runHomepageReadinessMaterializationCycle(
	opts: { owner?: string } = {}
): Promise<ReturnType<typeof materializeHomepageReadiness>> {
	const jobId = startJobRun('pipeline', {
		phase: 'homepage_readiness_materialize',
		owner: opts.owner ?? null
	});
	try {
		const result = materializeHomepageReadiness({
			owner: opts.owner ?? `worker-${process.pid}`
		});
		if (result.status === 'failed') {
			finishJobRun(jobId, 'failed', result, result.error);
			return result;
		}
		finishJobRun(jobId, 'success', result);
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		finishJobRun(jobId, 'failed', {}, message);
		throw err;
	}
}
