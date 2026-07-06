import './load-env.js';
import { formatBytes } from '../src/lib/utils.js';
import { runBackup } from '../src/lib/server/backup.js';

const result = await runBackup();

console.log(`Backup created: ${result.dir}`);
console.log(`  Time: ${result.createdAt}`);
console.log(`  Type: ${result.backupType}${result.compressed ? ' (compressed)' : ''}`);
console.log(`  Size: ${formatBytes(result.totalBytes)}`);
console.log('  Files: githubarchive.db, archives-manifest.json, metadata.json');
if (result.includeArchives) {
	console.log('  Archives: archives/ (full copy)');
}
if (result.compressed) {
	console.log(`  Archive: ${result.dirName}.tar.gz`);
}
