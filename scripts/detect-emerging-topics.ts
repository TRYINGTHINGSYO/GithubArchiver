import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import {
	CURRENT_EMERGING_DETECTION_VERSION,
	listEmergingNearMisses,
	runEmergingTopicDetection,
	type DetectionComparability,
	type DetectionWindowMetadata
} from '../src/lib/server/emerging-topics.js';

const WINDOW_DAYS = Number(process.env.EMERGING_WINDOW_DAYS ?? 7);
const LIMIT = Number(process.env.EMERGING_LIMIT ?? 100);
const NEAR_MISS_LIMIT = Number(process.env.EMERGING_NEAR_MISS_LIMIT ?? 25);
const VERSION = Number(process.env.EMERGING_VERSION ?? CURRENT_EMERGING_DETECTION_VERSION);
const PERIOD_END = process.env.EMERGING_PERIOD_END ? new Date(process.env.EMERGING_PERIOD_END) : undefined;
const CURRENT_DATASET_ID = process.env.EMERGING_CURRENT_DATASET_ID
	? Number(process.env.EMERGING_CURRENT_DATASET_ID)
	: undefined;
const PREVIOUS_DATASET_ID = process.env.EMERGING_PREVIOUS_DATASET_ID
	? Number(process.env.EMERGING_PREVIOUS_DATASET_ID)
	: undefined;

function printNearMisses(periodEnd: Date) {
	const nearMisses = listEmergingNearMisses({
		periodEnd,
		windowDays: WINDOW_DAYS,
		limit: NEAR_MISS_LIMIT,
		currentDatasetId: CURRENT_DATASET_ID,
		previousDatasetId: PREVIOUS_DATASET_ID
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
	const datasetPart = meta.datasetId != null ? `  dataset=#${meta.datasetId}` : '';
	const samplePart =
		meta.sampledRepos != null ? `  sampled=${meta.sampledRepos.toLocaleString()}` : '';
	console.log(
		`  ${label}: ${meta.windowStart.slice(0, 10)} → ${meta.windowEnd.slice(0, 10)}  source=${meta.ingestionSource}  observed=${meta.totalObservedRepos.toLocaleString()}${samplePart}  enriched=${meta.enrichedRepos.toLocaleString()} (${Math.round(meta.enrichedCoverage * 100)}%)  hours/shards=${meta.hoursProcessed}/${meta.hoursExpected} (${Math.round(coverage * 100)}%)${datasetPart}`
	);
}

function printComparability(comparability: DetectionComparability) {
	console.log('\nWindow provenance:');
	printWindow('current ', comparability.current);
	printWindow('previous', comparability.previous);
	if (comparability.comparisonLabel) {
		console.log(`  Comparison: ${comparability.comparisonLabel}`);
		if (comparability.current.comparisonMode === 'matched-hours') {
			console.log('  Scope: same UTC hour offsets in consecutive weeks; not a full-week estimate.');
		}
	}
	if (comparability.comparable) {
		console.log('  Windows are comparable — growth and momentum are active.');
	} else {
		console.log(
			`  Growth and momentum SUPPRESSED (${comparability.growthSuppressedReason}).\n  Detection uses absolute gates only; scores are momentum-free until both windows share a compatible dataset plan.`
		);
	}
}

async function main() {
	getDb();
	if (PERIOD_END && Number.isNaN(PERIOD_END.getTime())) {
		throw new Error(`Invalid EMERGING_PERIOD_END: ${process.env.EMERGING_PERIOD_END}`);
	}
	if (
		(CURRENT_DATASET_ID != null && PREVIOUS_DATASET_ID == null) ||
		(CURRENT_DATASET_ID == null && PREVIOUS_DATASET_ID != null)
	) {
		throw new Error(
			'Set both EMERGING_CURRENT_DATASET_ID and EMERGING_PREVIOUS_DATASET_ID, or neither.'
		);
	}
	if (CURRENT_DATASET_ID != null && Number.isNaN(CURRENT_DATASET_ID)) {
		throw new Error('Invalid EMERGING_CURRENT_DATASET_ID');
	}
	if (PREVIOUS_DATASET_ID != null && Number.isNaN(PREVIOUS_DATASET_ID)) {
		throw new Error('Invalid EMERGING_PREVIOUS_DATASET_ID');
	}

	const periodEnd = PERIOD_END ?? new Date();
	const result = runEmergingTopicDetection({
		periodEnd: PERIOD_END,
		windowDays: WINDOW_DAYS,
		limit: LIMIT,
		version: VERSION,
		currentDatasetId: CURRENT_DATASET_ID,
		previousDatasetId: PREVIOUS_DATASET_ID
	});

	printComparability(result.comparability);

	console.log(
		`\nDetected ${result.candidates.length} candidates and saved ${result.saved} emerging topics for ${result.periodStart}..${result.periodEnd}.`
	);
	for (const candidate of result.candidates.slice(0, 15)) {
		const growth =
			candidate.growthPercent == null ? 'growth=n/a' : `growth=${candidate.growthPercent}%`;
		const prevalence =
			candidate.prevalenceLiftPercent == null
				? 'prevalence-lift=n/a'
				: `prevalence-lift=${candidate.prevalenceLiftPercent}%`;
		console.log(
			`  ${candidate.label} (${candidate.candidateType}) score=${candidate.emergingScore} current=${candidate.currentCount} previous=${candidate.previousCount} owners=${candidate.distinctOwnerCount} ${growth} ${prevalence}`
		);
	}

	if (result.candidates.length === 0) {
		printNearMisses(periodEnd);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
