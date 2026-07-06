import './load-env.js';
import { getDb, listReposForRefresh } from '../src/lib/server/db/index.js';
import {
	handleEnrichmentFailed,
	handleRepoNotFound,
	refreshRepo
} from '../src/lib/server/enrich.js';
import { GitHubNotFoundError, GitHubRateLimitError } from '../src/lib/server/github.js';

const BATCH_SIZE = Number(process.env.REFRESH_BATCH_SIZE ?? 50);
const DELAY_MS = Number(process.env.REFRESH_DELAY_MS ?? 800);
const REFRESH_INTERVAL_HOURS = Number(process.env.REFRESH_INTERVAL_HOURS ?? 24);

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

async function main() {
	getDb();
	const pending = listReposForRefresh(BATCH_SIZE);

	if (pending.length === 0) {
		console.log('No enriched repos due for refresh.');
		return;
	}

	console.log(`Refreshing up to ${pending.length} repos (last_checked_at >${REFRESH_INTERVAL_HOURS}h ago)…`);
	if (!process.env.GITHUB_TOKEN) {
		console.warn('GITHUB_TOKEN not set — using unauthenticated rate limit (60 req/hr).');
	}

	let refreshed = 0;
	let failed = 0;

	for (const repo of pending) {
		try {
			await refreshRepo(repo);
			refreshed++;
			console.log(`  ✓ ${repo.full_name}`);
			await sleep(DELAY_MS);
		} catch (err) {
			if (err instanceof GitHubNotFoundError) {
				await handleRepoNotFound(repo);
				failed++;
				console.log(`  ✗ ${repo.full_name} — deleted on GitHub`);
			} else if (err instanceof GitHubRateLimitError) {
				console.error(`Rate limited until ${err.resetAt.toISOString()}. Stopping.`);
				break;
			} else {
				await handleEnrichmentFailed(repo, err instanceof Error ? err.message : String(err));
				failed++;
				console.error(`  ! ${repo.full_name}:`, err);
			}
		}
	}

	console.log(`Done: ${refreshed} refreshed, ${failed} failed/skipped.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
