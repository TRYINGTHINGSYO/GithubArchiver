import './load-env.js';
import { getDb, listEnrichedReposForArchive } from '../src/lib/server/db/index.js';
import { archiveRepo, getArchiveConfigFromEnv } from '../src/lib/server/archiver.js';
import { GitHubRateLimitError } from '../src/lib/server/github.js';

const MAX_REPOS = Number(process.env.ARCHIVE_MAX_REPOS ?? 10);
const DELAY_MS = Number(process.env.ARCHIVE_DELAY_MS ?? 1000);

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

async function main() {
	getDb();
	const config = getArchiveConfigFromEnv();
	const repos = listEnrichedReposForArchive(MAX_REPOS);

	if (repos.length === 0) {
		console.log('No enriched repos to archive.');
		return;
	}

	console.log(`Archiving up to ${repos.length} enriched repos...`);
	console.log(
		`Limits: max ${config.maxBytes} bytes, timeout ${config.timeoutMs}ms, dir ${config.archiveDir}`
	);

	let saved = 0;
	let skipped = 0;
	let failed = 0;

	for (const repo of repos) {
		try {
			const result = await archiveRepo(repo, config);
			const parts = [`readme:${result.readme}`, `source:${result.source}`];
			console.log(`  ${repo.full_name} — ${parts.join(', ')}`);
			if (result.error) console.log(`    ${result.error}`);
			if (result.readme === 'saved' || result.source === 'saved') saved++;
			if (result.readme === 'skipped' && result.source === 'skipped') skipped++;
			if (result.source === 'too_large' || result.source === 'timeout') failed++;
			await sleep(DELAY_MS);
		} catch (err) {
			if (err instanceof GitHubRateLimitError) {
				console.error(`Rate limited until ${err.resetAt.toISOString()}. Stopping.`);
				break;
			}
			failed++;
			console.error(`  ! ${repo.full_name}:`, err);
		}
	}

	console.log(`Done: ${saved} snapshots saved, ${skipped} fully skipped, ${failed} issues.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
