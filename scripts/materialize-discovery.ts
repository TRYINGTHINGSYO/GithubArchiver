import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import { runDiscoveryMaterializationCycle } from '../src/lib/server/workers/discovery.js';

getDb();

const result = await runDiscoveryMaterializationCycle({ owner: `cli-${process.pid}` });
console.log(JSON.stringify(result, null, 2));

if (result.status === 'failed') {
	process.exitCode = 1;
}
