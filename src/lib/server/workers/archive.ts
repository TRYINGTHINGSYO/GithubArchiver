import { listEnrichedReposForArchive } from '../db/index.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';
import { archiveRepo, getArchiveConfigFromEnv } from '../archiver.js';
import { GitHubRateLimitError } from '../github.js';

const MAX_REPOS = Number(process.env.ARCHIVE_MAX_REPOS ?? 25);
const DELAY_MS = Number(process.env.ARCHIVE_DELAY_MS ?? 1000);

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

export interface ArchiveCycleResult {
	planned: number;
	saved: number;
	skipped: number;
	issues: number;
	rateLimited: boolean;
	rateLimitResetAt?: string;
}

export async function runArchiveCycle(): Promise<ArchiveCycleResult> {
	const config = getArchiveConfigFromEnv();
	const repos = listEnrichedReposForArchive(MAX_REPOS);
	const jobId = startJobRun('archive', { max_repos: MAX_REPOS, planned: repos.length });

	const result: ArchiveCycleResult = {
		planned: repos.length,
		saved: 0,
		skipped: 0,
		issues: 0,
		rateLimited: false
	};

	if (repos.length === 0) {
		finishJobRun(jobId, 'success', { ...result, message: 'nothing to archive' });
		return result;
	}

	for (const repo of repos) {
		try {
			const archive = await archiveRepo(repo, config);
			if (archive.readme === 'saved' || archive.source === 'saved') result.saved++;
			else if (archive.readme === 'skipped' && archive.source === 'skipped') result.skipped++;
			else if (
				archive.source === 'too_large' ||
				archive.source === 'timeout' ||
				archive.error ||
				archive.source === 'missing'
			) {
				result.issues++;
			}
			await sleep(DELAY_MS);
		} catch (err) {
			if (err instanceof GitHubRateLimitError) {
				result.rateLimited = true;
				result.rateLimitResetAt = err.resetAt.toISOString();
				finishJobRun(jobId, 'failed', result, err.message);
				return result;
			}
			result.issues++;
		}
	}

	finishJobRun(jobId, 'success', result);
	return result;
}
