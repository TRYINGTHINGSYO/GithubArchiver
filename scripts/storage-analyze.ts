import './load-env.js';
import { formatBytes } from '../src/lib/utils.js';
import { runStorageAnalysis } from '../src/lib/server/storage.js';

const report = runStorageAnalysis({ cleanup: true });

console.log('Archive storage analysis');
console.log(`  On disk: ${formatBytes(report.total_bytes_on_disk)} (${report.file_count_on_disk} files)`);
console.log(`  Indexed: ${formatBytes(report.total_bytes_indexed)} (${report.snapshot_count} snapshots)`);
console.log(`  Keep last N (preview): ${report.keep_last_n}`);
console.log('');

console.log(`Largest repos (${report.largest_repos.length} shown):`);
for (const repo of report.largest_repos.slice(0, 10)) {
	console.log(`  ${repo.full_name}: ${formatBytes(repo.total_bytes)} (${repo.snapshot_count} snapshots)`);
}
console.log('');

console.log(`Duplicate SHA-256 groups: ${report.duplicate_groups.length} shown`);
console.log(`  Recoverable (estimate): ${formatBytes(report.duplicate_bytes_recoverable)}`);
for (const group of report.duplicate_groups.slice(0, 5)) {
	console.log(`  ${group.sha256.slice(0, 12)}… ×${group.count} ${formatBytes(group.total_bytes)}`);
}
console.log('');

console.log(`Missing DB rows (orphan files): ${formatBytes(report.missing_db_bytes)}`);
for (const path of report.missing_db_rows.slice(0, 5)) {
	console.log(`  ${path}`);
}
console.log('');

console.log(`Old snapshots (beyond keep-last-${report.keep_last_n}): ${formatBytes(report.old_snapshot_bytes)}`);
for (const row of report.old_snapshots.slice(0, 5)) {
	console.log(`  #${row.id} ${row.full_name} ${row.snapshot_type} ${row.archived_at}`);
}
console.log('');

if (report.cleanups.length > 0) {
	console.log('Cleanup:');
	for (const item of report.cleanups) {
		const tag = item.applied ? 'APPLIED' : 'SKIP';
		const freed = item.bytes_freed ? `, freed ${formatBytes(item.bytes_freed)}` : '';
		console.log(`[${tag}] ${item.name}: ${item.message}${freed}`);
	}
} else {
	console.log('Cleanup: none (set STORAGE_DELETE_ORPHANS, STORAGE_DELETE_DUPLICATES, or STORAGE_KEEP_LAST_N)');
}
