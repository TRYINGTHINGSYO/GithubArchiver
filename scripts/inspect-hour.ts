import './load-env.js';
import { defaultHourKey } from '../src/lib/server/gharchive.js';
import { formatInspection, inspectHour } from './lib/inspect-hour.js';

const hourKey = process.env.GH_ARCHIVE_HOUR ?? defaultHourKey();

async function main() {
	console.log(`Inspecting GH Archive hour: ${hourKey}\n`);
	const report = await inspectHour(hourKey);
	console.log(formatInspection(report));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
