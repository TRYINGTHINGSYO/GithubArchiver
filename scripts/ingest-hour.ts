import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import { defaultHourKey } from '../src/lib/server/gharchive.js';
import { ingestHour } from './lib/ingest-core.js';

const hourKey = process.env.GH_ARCHIVE_HOUR ?? defaultHourKey();

async function main() {
	getDb();
	console.log(`Ingesting hour: ${hourKey}`);

	const result = await ingestHour(hourKey);

	console.log(`URL:            ${result.url}`);
	console.log(`Outcome:        ${result.outcome}`);
	console.log(`Source:         ${result.source}`);
	if (result.httpStatus) console.log(`HTTP status:    ${result.httpStatus}`);
	if (result.retries > 0) console.log(`Retries:        ${result.retries}`);
	if (result.outcome === 'downloaded') {
		console.log(`Parsed events:  ${result.parsedEvents}`);
		console.log(`Repo creates:   ${result.repoCreates}`);
		if (result.searchQuery) console.log(`Search query:   ${result.searchQuery}`);
		if (result.searchFound != null) console.log(`Search found:   ${result.searchFound}`);
		console.log(`Inserted:       ${result.inserted}`);
		console.log(`Skipped:        ${result.skipped} (already in database)`);
	}
	if (result.error) console.log(`Error:          ${result.error}`);

	if (result.outcome !== 'downloaded') {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
