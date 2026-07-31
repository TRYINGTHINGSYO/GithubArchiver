import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import { runHomepageReadinessMaterializationCycle } from '../src/lib/server/workers/homepage-readiness.js';

getDb();

const result = await runHomepageReadinessMaterializationCycle({
	owner: `cli-${process.pid}`
});
console.log(JSON.stringify(result, null, 2));

if (result.status === 'failed') {
	process.exitCode = 1;
}
