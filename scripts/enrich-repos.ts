import './load-env.js';
import {
	getDb,
	getDatasetEnrichmentProgress,
	getDatasetRun,
	listUnenrichedDatasetRepos,
	listUnenrichedRepos
} from '../src/lib/server/db/index.js';
import { finishJobRun, startJobRun } from '../src/lib/server/db/jobs.js';
import {
	enrichRepo,
	handleEnrichmentFailed,
	handleRepoNotFound,
	type EnrichmentLevel
} from '../src/lib/server/enrich.js';
import {
	GitHubNotFoundError,
	GitHubRateLimitError,
	hasGitHubToken
} from '../src/lib/server/github.js';

const BATCH_SIZE = Number(process.env.ENRICH_BATCH_SIZE ?? 50);
const DELAY_MS = Number(process.env.ENRICH_DELAY_MS ?? 800);
const MAX_BATCHES = Number(process.env.ENRICH_MAX_BATCHES ?? 0);
const LEVEL = Number(process.env.ENRICH_LEVEL ?? 1) as EnrichmentLevel;
const SYNC_RELEASES = process.env.ENRICH_SYNC_RELEASES === '1';
const CREATED_FROM = process.env.ENRICH_CREATED_FROM;
const CREATED_TO = process.env.ENRICH_CREATED_TO;
const DATASET_ID = process.env.ENRICH_DATASET_ID ? Number(process.env.ENRICH_DATASET_ID) : undefined;

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

async function main() {
	getDb();

	if (!hasGitHubToken()) {
		console.warn('GITHUB_TOKEN not set — using unauthenticated rate limit (60 req/hr).');
		console.warn('Create a local .env with GITHUB_TOKEN=... (never commit the token).');
	}

	if (DATASET_ID != null) {
		if (Number.isNaN(DATASET_ID)) throw new Error('Invalid ENRICH_DATASET_ID');
		const run = getDatasetRun(DATASET_ID);
		if (!run) throw new Error(`Dataset run #${DATASET_ID} not found`);
	}

	let enriched = 0;
	let failed = 0;
	let deleted = 0;
	let requests = 0;
	let batches = 0;
	const startedAt = Date.now();
	const jobId = startJobRun('enrich', {
		source: 'cli',
		level: LEVEL,
		sync_releases: SYNC_RELEASES,
		max_batches: MAX_BATCHES,
		dataset_id: DATASET_ID ?? null
	});

	console.log(
		`Enriching Level ${LEVEL} (releases=${SYNC_RELEASES ? 'on' : 'off'}, batch=${BATCH_SIZE}${MAX_BATCHES > 0 ? `, max batches=${MAX_BATCHES}` : ''}${DATASET_ID != null ? `, dataset #${DATASET_ID}` : ''}${CREATED_FROM || CREATED_TO ? `, created ${CREATED_FROM ?? '*'} → ${CREATED_TO ?? '*'}` : ''})...`
	);

	for (;;) {
		if (MAX_BATCHES > 0 && batches >= MAX_BATCHES) break;

		const pending =
			DATASET_ID != null
				? listUnenrichedDatasetRepos(DATASET_ID, BATCH_SIZE)
				: listUnenrichedRepos(BATCH_SIZE, {
						createdFrom: CREATED_FROM,
						createdTo: CREATED_TO
					});
		if (pending.length === 0) {
			if (batches === 0) console.log('No unenriched repos.');
			break;
		}

		batches += 1;
		console.log(`Batch ${batches}: ${pending.length} repos`);

		for (const repo of pending) {
			try {
				const result = await enrichRepo(repo, {
					level: LEVEL,
					syncReleases: SYNC_RELEASES
				});
				enriched++;
				requests += result.requests;
				console.log(`  ✓ ${repo.full_name} (${result.requests} req)`);
				await sleep(DELAY_MS);
			} catch (err) {
				if (err instanceof GitHubNotFoundError) {
					await handleRepoNotFound(repo);
					deleted++;
					failed++;
					console.log(`  ✗ ${repo.full_name} — deleted on GitHub`);
				} else if (err instanceof GitHubRateLimitError) {
					const kind = err.secondary ? 'secondary rate limit' : 'primary rate limit';
					console.error(
						`${kind}: retry after ${err.resetAt.toISOString()}. Stopping after ${enriched} enrichments.`
					);
					stopOnRateLimit(jobId, { enriched, failed, deleted, requests, startedAt, batches });
					if (DATASET_ID != null) printDatasetProgress(DATASET_ID);
					return;
				} else {
					await handleEnrichmentFailed(repo, err instanceof Error ? err.message : String(err));
					failed++;
					console.error(`  ! ${repo.full_name}:`, err instanceof Error ? err.message : err);
				}
			}
		}

		if (pending.length < BATCH_SIZE) break;
	}

	printSummary({ enriched, failed, deleted, requests, startedAt, batches, stopped: false });
	if (DATASET_ID != null) printDatasetProgress(DATASET_ID);
	finishJobRun(jobId, 'success', {
		enriched,
		failed,
		deleted,
		requests,
		batches,
		dataset_id: DATASET_ID ?? null,
		avg_requests_per_repo: enriched > 0 ? requests / enriched : 0
	});
}

function printDatasetProgress(datasetId: number) {
	const progress = getDatasetEnrichmentProgress(datasetId);
	console.log(
		`Dataset #${datasetId}: ${progress.enriched}/${progress.members} enriched (${Math.round(progress.effectiveCoverage * 100)}% effective), ${progress.deleted} deleted, ${progress.failed} failed, ${progress.remaining} remaining.`
	);
}

function stopOnRateLimit(
	jobId: number,
	summary: {
		enriched: number;
		failed: number;
		deleted: number;
		requests: number;
		startedAt: number;
		batches: number;
	}
) {
	printSummary({ ...summary, stopped: true });
	finishJobRun(jobId, 'failed', {
		...summary,
		avg_requests_per_repo: summary.enriched > 0 ? summary.requests / summary.enriched : 0
	}, 'rate limited');
}

function printSummary(opts: {
	enriched: number;
	failed: number;
	deleted: number;
	requests: number;
	startedAt: number;
	batches: number;
	stopped: boolean;
}) {
	const elapsedSec = Math.max(0.001, (Date.now() - opts.startedAt) / 1000);
	const avgRequests =
		opts.enriched > 0 ? (opts.requests / opts.enriched).toFixed(2) : '0';
	console.log(
		`Done${opts.stopped ? ' (stopped early)' : ''}: ${opts.enriched} enriched, ${opts.deleted} deleted, ${opts.failed} failed/skipped across ${opts.batches} batches.`
	);
	console.log(
		`Requests: ${opts.requests} total, ${avgRequests} avg/repo, ${(opts.requests / elapsedSec).toFixed(2)} req/s wall-clock.`
	);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
