import './load-env.js';

import { getDb } from '../src/lib/server/db/index.js';

import { defaultHourKey, hourKeysForToday } from '../src/lib/server/gharchive.js';

import { formatIngestLine, ingestHour } from './lib/ingest-core.js';



async function main() {

	getDb();

	const keys = hourKeysForToday();

	const latest = defaultHourKey();



	if (keys.length === 0) {

		console.log(`No completed hours yet today (UTC). Latest publishable hour: ${latest}`);

		return;

	}



	console.log(`Ingesting ${keys.length} hour(s) for today (UTC), through ${latest}…`);



	let downloaded = 0;

	let unavailable = 0;

	let failed = 0;

	let totalParsed = 0;

	let totalCreates = 0;

	let totalInserted = 0;

	let totalSkipped = 0;



	for (const key of keys) {

		const result = await ingestHour(key);

		console.log(formatIngestLine(result));



		if (result.outcome === 'downloaded') {

			downloaded++;

			totalParsed += result.parsedEvents;

			totalCreates += result.repoCreates;

			totalInserted += result.inserted;

			totalSkipped += result.skipped;

		} else if (result.outcome === 'unavailable') {

			unavailable++;

		} else {

			failed++;

		}

	}



	console.log('---');

	console.log(`Downloaded:     ${downloaded}`);

	console.log(`Unavailable:    ${unavailable}`);

	console.log(`Failed:         ${failed}`);

	console.log(`Parsed events:  ${totalParsed}`);

	console.log(`Repo creates:   ${totalCreates}`);

	console.log(`Inserted:       ${totalInserted}`);

	console.log(`Skipped:        ${totalSkipped}`);



	if (failed > 0) process.exit(1);

}



main().catch((err) => {

	console.error(err);

	process.exit(1);

});

