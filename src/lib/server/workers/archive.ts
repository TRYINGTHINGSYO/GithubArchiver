import { listEnrichedReposForArchive } from '../db/index.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';
import {
	classifyArchiveRepoOutcome,
	recordArchiveFailure,
	type ArchiveRepoOutcome
} from '../archive-outcomes.js';
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
	blocked: number;
	rateLimited: boolean;
	rateLimitResetAt?: string;
	outcomes: ArchiveRepoOutcome[];
}

function applyOutcome(result: ArchiveCycleResult, outcome: ArchiveRepoOutcome): void {
	switch (outcome.bucket) {
		case 'saved':
			result.saved++;
			break;
		case 'skipped':
			result.skipped++;
			break;
		case 'blocked':
			result.blocked++;
			break;
		case 'issues':
			result.issues++;
			break;
	}
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
		blocked: 0,
		rateLimited: false,
		outcomes: []
	};

	if (repos.length === 0) {
		finishJobRun(jobId, 'success', { ...result, message: 'nothing to archive' });
		return result;
	}

	for (const repo of repos) {
		try {
			const archive = await archiveRepo(repo, config);
			const outcome = classifyArchiveRepoOutcome(repo.id, archive);
			result.outcomes.push(outcome);
			applyOutcome(result, outcome);

			if (outcome.permanent) {
				recordArchiveFailure(repo.id, archive);
			}
			await sleep(DELAY_MS);
		} catch (err) {
			if (err instanceof GitHubRateLimitError) {
				result.rateLimited = true;
				result.rateLimitResetAt = err.resetAt.toISOString();
				finishJobRun(jobId, 'failed', result, err.message);
				return result;
			}
			const failure = classifyArchiveRepoOutcome(repo.id, {
				repo: repo.full_name,
				readme: 'missing',
				source: 'missing',
				zip: 'missing',
				error: err instanceof Error ? err.message : String(err)
			});
			result.outcomes.push(failure);
			applyOutcome(result, failure);
		}
	}

	finishJobRun(jobId, 'success', result);
	return result;
}
