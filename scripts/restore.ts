import './load-env.js';
import { formatBytes } from '../src/lib/utils.js';
import { runRestore } from '../src/lib/server/restore.js';

const result = await runRestore({
	backupPath: process.env.RESTORE_BACKUP_PATH ?? ''
});

console.log('');
console.log('Restore complete.');
console.log(`  From: ${result.restoredFrom}`);
console.log(`  Type: ${result.backupType}`);
console.log(`  Database: ${result.databasePath}`);
console.log(`  Archives restored: ${result.archivesRestored ? 'yes' : 'no'}`);
console.log(`  Pre-restore backup: ${result.preRestoreBackup.dir}`);
console.log(`  Pre-restore size: ${formatBytes(result.preRestoreBackup.totalBytes)}`);
