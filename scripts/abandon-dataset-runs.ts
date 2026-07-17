import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';

const ids = (process.argv[2] ?? '5,6')
	.split(',')
	.map((value) => Number(value.trim()))
	.filter((id) => Number.isInteger(id) && id > 0);

const db = getDb();
const now = new Date().toISOString();
const update = db.prepare(
	`UPDATE backfill_dataset_runs
	 SET status = 'failed', updated_at = ?, completed_at = ?
	 WHERE id = ? AND status IN ('pending', 'running', 'paused')`
);

for (const id of ids) {
	const result = update.run(now, now, id);
	const row = db.prepare('SELECT id, status FROM backfill_dataset_runs WHERE id = ?').get(id) as
		| { id: number; status: string }
		| undefined;
	console.log(
		row
			? `#${row.id} → ${row.status}${result.changes ? ' (abandoned)' : ' (unchanged)'}`
			: `#${id} not found`
	);
}
