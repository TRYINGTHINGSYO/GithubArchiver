import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import { defaultHourKey } from '../src/lib/server/gharchive.js';
import { ingestReposFromSearch } from '../src/lib/server/repo-discovery.js';

const hourKey = process.env.GH_ARCHIVE_HOUR ?? defaultHourKey();

async function main() {
	getDb();
	console.log(`GitHub Search discovery for hour: ${hourKey}`);
	if (!process.env.GITHUB_TOKEN) {
		console.warn('GITHUB_TOKEN not set — Search API limited to 30 requests/minute.');
	}

	const result = await ingestReposFromSearch(hourKey);

	console.log(`Query:        ${result.query}`);
	console.log(`Total count:  ${result.totalCount}`);
	console.log(`Found:        ${result.found}`);
	console.log(`Inserted:     ${result.inserted}`);
	console.log(`Skipped:      ${result.skipped}`);
	console.log(`Pages:        ${result.pages}`);
	console.log(`Shards:       ${result.shards}`);
	if (result.incomplete) console.log('Note:         GitHub marked results incomplete (hit search cap).');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
