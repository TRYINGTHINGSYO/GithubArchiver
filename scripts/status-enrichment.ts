import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import {
	estimateEnrichmentWorkload,
	getDataReadiness
} from '../src/lib/server/data-readiness.js';
import { fetchGitHubRateLimit, hasGitHubToken } from '../src/lib/server/github.js';

const WINDOW_DAYS = Number(process.env.STATUS_WINDOW_DAYS ?? 7);
const PERIOD_END = process.env.EMERGING_PERIOD_END
	? new Date(process.env.EMERGING_PERIOD_END)
	: undefined;

function pct(part: number, whole: number): string {
	if (whole <= 0) return '0%';
	return `${((part / whole) * 100).toFixed(2)}%`;
}

async function main() {
	getDb();
	if (PERIOD_END && Number.isNaN(PERIOD_END.getTime())) {
		throw new Error(`Invalid EMERGING_PERIOD_END: ${process.env.EMERGING_PERIOD_END}`);
	}

	const readiness = getDataReadiness({
		windowDays: WINDOW_DAYS,
		periodEnd: PERIOD_END
	});
	const workload = estimateEnrichmentWorkload(readiness);
	const rateLimit = await fetchGitHubRateLimit().catch(() => null);

	console.log('Repositories');
	console.log(`  Total:              ${readiness.totalRepos.toLocaleString().padStart(10)}`);
	console.log(
		`  Enriched:           ${readiness.enrichedRepos.toLocaleString().padStart(10)}  (${pct(readiness.enrichedRepos, readiness.totalRepos)})`
	);
	console.log(`  Backlog:            ${readiness.enrichmentBacklog.toLocaleString().padStart(10)}`);
	console.log(`  Scored:             ${readiness.scoredRepos.toLocaleString().padStart(10)}`);
	console.log(`  Clustered:          ${readiness.clusteredRepos.toLocaleString().padStart(10)}`);
	console.log(`  Stories:            ${readiness.storyRepos.toLocaleString().padStart(10)}`);
	console.log(
		`  Levels:             L0=${readiness.enrichmentLevels[0] ?? 0} L1=${readiness.enrichmentLevels[1] ?? 0} L2=${readiness.enrichmentLevels[2] ?? 0} L3=${readiness.enrichmentLevels[3] ?? 0}`
	);

	console.log('\nRecent (30 days)');
	console.log(`  Repositories:       ${readiness.recentRepos.toLocaleString().padStart(10)}`);
	console.log(`  Enriched:           ${readiness.recentEnrichedRepos.toLocaleString().padStart(10)}`);

	console.log('\nRecent detection window');
	console.log(
		`  Period: ${readiness.windowStart.slice(0, 10)} → ${readiness.windowEnd.slice(0, 10)}`
	);
	console.log(`  Repositories:       ${readiness.currentWindowRepos.toLocaleString().padStart(10)}`);
	console.log(
		`  Enriched:           ${readiness.currentWindowEnrichedRepos.toLocaleString().padStart(10)}`
	);
	console.log(
		`  Distinct owners:    ${readiness.distinctOwnersInWindow.toLocaleString().padStart(10)}`
	);
	console.log(
		`  Detection ready:    ${String(readiness.emergingDetectionReady ? 'Yes' : 'No').padStart(10)}`
	);

	console.log('\nPrevious comparison window');
	console.log(
		`  Period: ${readiness.previousWindowStart.slice(0, 10)} → ${readiness.previousWindowEnd.slice(0, 10)}`
	);
	console.log(
		`  Repositories:       ${readiness.previousWindowRepos.toLocaleString().padStart(10)}`
	);
	console.log(
		`  Enriched:           ${readiness.previousWindowEnrichedRepos.toLocaleString().padStart(10)}`
	);
	console.log(
		`  Distinct owners:    ${readiness.previousWindowDistinctOwners.toLocaleString().padStart(10)}`
	);

	console.log('\nEstimated API workload');
	console.log(`  Level 1 requests:   ${workload.level1Requests.toLocaleString().padStart(10)}`);
	console.log(`  Level 2 candidates: ${workload.level2Candidates.toLocaleString().padStart(10)}`);

	console.log('\nGitHub auth');
	console.log(`  Token configured:   ${hasGitHubToken() ? 'Yes' : 'No'}`);
	if (rateLimit) {
		console.log(
			`  Core remaining:     ${rateLimit.remaining.toLocaleString().padStart(10)} / ${rateLimit.limit.toLocaleString()}`
		);
		if (rateLimit.resetAt) {
			console.log(`  Core resets at:     ${rateLimit.resetAt}`);
		}
	}

	if (readiness.readinessReasons.length > 0) {
		console.log('\nReadiness notes');
		for (const reason of readiness.readinessReasons) {
			console.log(`  - ${reason}`);
		}
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
