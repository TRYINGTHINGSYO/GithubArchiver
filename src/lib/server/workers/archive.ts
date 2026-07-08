import { listEnrichedReposForArchive } from '../db/index.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';
import {
	classifyArchiveRepoOutcome,
	recordArchiveFailure,
	type ArchiveRepoOutcome
} from '../archive-outcomes.js';
import { archiveRepo, getArchiveConfigFromEnv } from '../archiver.js';
import { GitHubRateLimitError } from '../github.js';
import { enforceStoragePressureLimit } from '../storage.js';

const MAX_REPOS = Number(process.env.ARCHIVE_MAX_REPOS ?? 50);
const DELAY_MS = Number(process.env.ARCHIVE_DELAY_MS ?? 100);
const CONCURRENCY = Math.max(1, Number(process.env.ARCHIVE_CONCURRENCY ?? 5));

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

async function archiveOneRepo(
	repo: Awaited<ReturnType<typeof listEnrichedReposForArchive>>[number],
	config: ReturnType<typeof getArchiveConfigFromEnv>
): Promise<ArchiveRepoOutcome> {
	try {
		const archive = await archiveRepo(repo, config);
		const outcome = classifyArchiveRepoOutcome(repo.id, archive);
		if (outcome.permanent) {
			recordArchiveFailure(repo.id, archive);
		}
		return outcome;
	} catch (err) {
		if (err instanceof GitHubRateLimitError) {
			throw err;
		}
		return classifyArchiveRepoOutcome(repo.id, {
			repo: repo.full_name,
			readme: 'missing',
			source: 'missing',
			zip: 'missing',
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

async function runArchivePool(
	repos: Awaited<ReturnType<typeof listEnrichedReposForArchive>>,
	config: ReturnType<typeof getArchiveConfigFromEnv>
): Promise<ArchiveRepoOutcome[]> {
	const outcomes: ArchiveRepoOutcome[] = [];
	let index = 0;

	async function worker(): Promise<void> {
		while (index < repos.length) {
			const current = repos[index++];
			const outcome = await archiveOneRepo(current, config);
			outcomes.push(outcome);
			if (DELAY_MS > 0) await sleep(DELAY_MS);
		}
	}

	const workers = Array.from({ length: Math.min(CONCURRENCY, repos.length) }, () => worker());
	await Promise.all(workers);
	return outcomes;
}

export async function runArchiveCycle(): Promise<ArchiveCycleResult> {
	const config = getArchiveConfigFromEnv();
	const pressure = enforceStoragePressureLimit();
	if (
		pressure.triggered &&
		pressure.freeBytesAfter !== null &&
		pressure.freeBytesAfter < pressure.minFreeBytes
	) {
		const jobId = startJobRun('archive', {
			storage_pressure: true,
			free_bytes_before: pressure.freeBytesBefore,
			free_bytes_after: pressure.freeBytesAfter,
			min_free_bytes: pressure.minFreeBytes,
			cleanups: pressure.report?.cleanups ?? []
		});
		const result: ArchiveCycleResult = {
			planned: 0,
			saved: 0,
			skipped: 0,
			issues: 0,
			blocked: 1,
			rateLimited: false,
			outcomes: []
		};
		finishJobRun(jobId, 'failed', result, 'Archive storage free space is below the safety threshold.');
		return result;
	}

	const repos = listEnrichedReposForArchive(MAX_REPOS);
	const jobId = startJobRun('archive', {
		max_repos: MAX_REPOS,
		concurrency: CONCURRENCY,
		planned: repos.length
	});

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

	try {
		const outcomes = await runArchivePool(repos, config);
		result.outcomes = outcomes;
		for (const outcome of outcomes) {
			applyOutcome(result, outcome);
		}
	} catch (err) {
		if (err instanceof GitHubRateLimitError) {
			result.rateLimited = true;
			result.rateLimitResetAt = err.resetAt.toISOString();
			finishJobRun(jobId, 'failed', result, err.message);
			return result;
		}
		throw err;
	}

	finishJobRun(jobId, 'success', result);
	return result;
}

export function getArchiveWorkerConfig() {
	return {
		maxRepos: MAX_REPOS,
		delayMs: DELAY_MS,
		concurrency: CONCURRENCY
	};
}
