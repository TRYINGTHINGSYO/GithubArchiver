import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import {
	listEmergingNearMisses,
	type DetectionComparability,
	type DetectionWindowMetadata
} from '../src/lib/server/emerging-topics.js';
import { runEmergingTopicCycle } from '../src/lib/server/workers/emerging.js';

const WINDOW_DAYS = Number(process.env.EMERGING_WINDOW_DAYS ?? 7);
const NEAR_MISS_LIMIT = Number(process.env.EMERGING_NEAR_MISS_LIMIT ?? 25);
const PERIOD_END = process.env.EMERGING_PERIOD_END ? new Date(process.env.EMERGING_PERIOD_END) : undefined;

function printNearMisses(periodEnd: Date) {
	const nearMisses = listEmergingNearMisses({
		periodEnd,
		windowDays: WINDOW_DAYS,
		limit: NEAR_MISS_LIMIT
	});
	if (nearMisses.length === 0) {
		console.log('\nNo near-miss candidates (current count >= 3).');
		return;
	}
	console.log(`\nNear-miss candidates (top ${nearMisses.length}):`);
	for (const miss of nearMisses) {
		console.log(`${miss.key} [${miss.candidateType}]`);
		console.log(`  current: ${miss.currentCount} / required: 10`);
		console.log(`  previous: ${miss.previousCount}`);
		console.log(`  owners: ${miss.distinctOwnerCount} / required: 5`);
		console.log(`  high signal: ${miss.highSignalCount} / required: 3`);
		if (miss.emergingScore != null) {
			console.log(`  emerging score: ${miss.emergingScore} / required: 35`);
		}
		console.log(`  rejected because: ${miss.rejectedBecause}`);
	}
}

function printWindow(label: string, meta: DetectionWindowMetadata) {
	const coverage = meta.hoursExpected > 0 ? meta.hoursProcessed / meta.hoursExpected : 0;
	console.log(
		`  ${label}: ${meta.windowStart.slice(0, 10)} → ${meta.windowEnd.slice(0, 10)}  source=${meta.ingestionSource}  observed=${meta.totalObservedRepos.toLocaleString()}  enriched=${meta.enrichedRepos.toLocaleString()} (${Math.round(meta.enrichedCoverage * 100)}%)  hours/shards=${meta.hoursProcessed}/${meta.hoursExpected} (${Math.round(coverage * 100)}%)`
	);
}

function printComparability(comparability: DetectionComparability) {
	console.log('\nWindow provenance:');
	printWindow('current ', comparability.current);
	printWindow('previous', comparability.previous);
	if (comparability.comparable) {
		console.log('  Windows are comparable — growth and momentum are active.');
	} else {
		console.log(
			`  Growth and momentum SUPPRESSED (${comparability.growthSuppressedReason}).`
		);
	}
}

async function main() {
	getDb();
	if (PERIOD_END && Number.isNaN(PERIOD_END.getTime())) {
		throw new Error(`Invalid EMERGING_PERIOD_END: ${process.env.EMERGING_PERIOD_END}`);
	}

	const periodEnd = PERIOD_END ?? new Date();
	const result = await runEmergingTopicCycle({ periodEnd, windowDays: WINDOW_DAYS });

	console.log(
		`\nDetected ${result.candidates} candidates and saved ${result.saved} emerging topics for ${result.periodStart}..${result.periodEnd}.`
	);

	if (result.candidates === 0) {
		printNearMisses(periodEnd);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
