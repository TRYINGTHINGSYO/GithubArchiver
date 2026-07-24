import './load-env.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/lib/server/db/index.js';
import { buildIntelligenceAuditReport } from '../src/lib/server/intelligence-audit.js';

const LIMIT = Number(process.env.AUDIT_LIMIT ?? 10);
const OUT_DIR = process.env.AUDIT_OUT_DIR ?? './data';

function main() {
	getDb();
	const report = buildIntelligenceAuditReport(LIMIT);
	mkdirSync(OUT_DIR, { recursive: true });
	const outPath = join(OUT_DIR, `intelligence-audit-${Date.now()}.json`);
	writeFileSync(outPath, JSON.stringify(report, null, 2));

	console.log(`Intelligence audit written to ${outPath}`);
	console.log(`Generated at ${report.generatedAt}`);
	console.log('\nCategory counts:');
	for (const row of report.categoryCounts.slice(0, 15)) {
		console.log(`  ${row.category}: ${row.count}`);
	}
	console.log('\nCluster counts:');
	for (const row of report.clusterCounts.slice(0, 15)) {
		console.log(`  ${row.slug}: ${row.count}`);
	}
	console.log(`\nLowest-confidence assignments: ${report.lowestConfidenceCategories.length}`);
	console.log(`Likely cluster false positives: ${report.likelyClusterFalsePositives.length}`);
	console.log(`Multi-cluster conflicts: ${report.multiClusterConflicts.length}`);
	console.log(`Description contradictions: ${report.descriptionContradictions.length}`);
	console.log('\nTop generic evidence terms:');
	for (const row of report.genericEvidenceTerms.slice(0, 8)) {
		console.log(`  ${row.term}: ${row.count}`);
	}
}

main();
