import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import {
	createPairedDatasetRuns,
	createMatchedDatasetPair,
	createDatasetRun,
	getDatasetEnrichmentProgress,
	getDatasetRun,
	listDatasetRuns,
	ingestAndFreezeMatchedDatasetPair,
	sampleDatasetFromExistingRepos,
	evaluateDatasetComparability,
	refreshDatasetEnrichmentCounts
} from '../src/lib/server/dataset-runs.js';

const action = (process.argv[2] ?? process.env.DATASET_ACTION ?? 'status').toLowerCase();

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

function printRun(run: ReturnType<typeof getDatasetRun>) {
	if (!run) return;
	const completedRatio =
		run.expectedShards > 0 ? Math.round((run.completedShards / run.expectedShards) * 100) : 0;
	const enrichPct =
		run.sampledRepos > 0 ? Math.round((run.enrichedRepos / run.sampledRepos) * 100) : 0;
	console.log(
		`#${run.id}  ${run.windowStart.slice(0, 10)} → ${run.windowEnd.slice(0, 10)}  status=${run.status}`
	);
	console.log(
		`  mode=${run.comparisonMode}  source=${run.source}  q=${run.queryVersion} shard=${run.shardingVersion} dedupe=${run.deduplicationVersion} sample=${run.samplingVersion} construction=${run.constructionVersion} pool=${run.candidatePoolSize} max/hour=${run.maxPerHour} target=${run.targetSampleSize}`
	);
	if (run.comparisonMode === 'matched-hours') {
		console.log(
			`  matched offsets=${run.matchedHourOffsets.join(',')}  paired-run=#${run.pairedRunId ?? '—'}`
		);
	}
	console.log(
		`  shards ${run.completedShards}/${run.expectedShards} (${completedRatio}%)  partial=${run.partialShards} failed=${run.failedShards}`
	);
	console.log(
		`  observed=${run.observedRepos.toLocaleString()}  sampled=${run.sampledRepos.toLocaleString()}  enriched=${run.enrichedRepos.toLocaleString()} (${enrichPct}%)`
	);
	const progress = getDatasetEnrichmentProgress(run.id);
	console.log(
		`  members=${progress.members}  enriched=${progress.enriched} (${Math.round(progress.effectiveCoverage * 100)}% eff.)  deleted=${progress.deleted}  failed=${progress.failed}  remaining=${progress.remaining}`
	);
}

async function main() {
	getDb();

	if (action === 'create-matched-pair') {
		const mode = process.env.DATASET_COMPARISON_MODE ?? 'matched-hours';
		if (mode !== 'matched-hours') {
			throw new Error('DATASET_COMPARISON_MODE must be matched-hours for this command');
		}
		const previousStart = requireEnv('DATASET_PREVIOUS_START');
		const currentStart = requireEnv('DATASET_CURRENT_START');
		const hoursPerDay = (process.env.DATASET_MATCHED_HOURS_PER_DAY ?? '0,6,12,18')
			.split(',')
			.map((value) => Number(value.trim()));
		const samplePerHour = Number(process.env.DATASET_SAMPLE_PER_HOUR ?? 25);
		const candidatePoolSize = Number(process.env.DATASET_CANDIDATE_POOL_SIZE ?? 100);
		const pair = createMatchedDatasetPair({
			previousStart,
			currentStart,
			hoursPerDay,
			samplePerHour,
			candidatePoolSize
		});
		console.log(
			`Created matched pair #${pair.previous.id}/#${pair.current.id}; sample-first construction for ${pair.requestedHourOffsets.length} paired UTC hours (pool=${candidatePoolSize}, sample/hour=${samplePerHour})...`
		);
		const frozen = await ingestAndFreezeMatchedDatasetPair(pair.previous.id, pair.current.id);
		console.log(
			`\nMatched pair frozen: ${frozen.includedHourOffsets.length} included, ${frozen.excludedHourOffsets.length} excluded. No cross-hour fill was used.`
		);
		printRun(frozen.previous);
		printRun(frozen.current);
		console.log(
			`\nNext:\n  $env:ENRICH_DATASET_ID='${frozen.previous.id}'; npm run enrich:repos\n  $env:ENRICH_DATASET_ID='${frozen.current.id}'; npm run enrich:repos`
		);
		return;
	}

	if (action === 'build-matched-pair') {
		const previousId = Number(requireEnv('DATASET_PREVIOUS_ID'));
		const currentId = Number(requireEnv('DATASET_CURRENT_ID'));
		const frozen = await ingestAndFreezeMatchedDatasetPair(previousId, currentId);
		console.log(
			`Matched pair frozen: ${frozen.includedHourOffsets.length} included, ${frozen.excludedHourOffsets.length} excluded. No cross-hour fill was used.`
		);
		printRun(frozen.previous);
		printRun(frozen.current);
		return;
	}

	if (action === 'create-pair') {
		const previousStart = requireEnv('DATASET_PREVIOUS_START');
		const previousEnd = requireEnv('DATASET_PREVIOUS_END');
		const currentStart = requireEnv('DATASET_CURRENT_START');
		const currentEnd = requireEnv('DATASET_CURRENT_END');
		const maxPerHour = Number(process.env.DATASET_MAX_PER_HOUR ?? 9);
		const targetSampleSize = Number(process.env.DATASET_TARGET_SAMPLE_SIZE ?? 1500);
		const pair = createPairedDatasetRuns({
			previousStart,
			previousEnd,
			currentStart,
			currentEnd,
			maxPerHour,
			targetSampleSize
		});
		console.log('Created paired dataset runs:');
		printRun(pair.previous);
		printRun(pair.current);
		console.log(
			`\nNext:\n  DATASET_RUN_ID=${pair.previous.id} npm run dataset:sample\n  DATASET_RUN_ID=${pair.current.id} npm run dataset:sample`
		);
		return;
	}

	if (action === 'create') {
		const windowStart = requireEnv('DATASET_WINDOW_START');
		const windowEnd = requireEnv('DATASET_WINDOW_END');
		const maxPerHour = Number(process.env.DATASET_MAX_PER_HOUR ?? 9);
		const targetSampleSize = Number(process.env.DATASET_TARGET_SAMPLE_SIZE ?? 1500);
		const run = createDatasetRun({ windowStart, windowEnd, maxPerHour, targetSampleSize });
		console.log('Created dataset run:');
		printRun(run);
		return;
	}

	if (action === 'sample') {
		const runId = Number(requireEnv('DATASET_RUN_ID'));
		const run = sampleDatasetFromExistingRepos(runId);
		console.log('Sampled dataset run from existing repositories:');
		printRun(run);
		return;
	}

	if (action === 'compare') {
		const currentId = Number(requireEnv('DATASET_CURRENT_ID'));
		const previousId = Number(requireEnv('DATASET_PREVIOUS_ID'));
		const current = refreshDatasetEnrichmentCounts(currentId);
		const previous = refreshDatasetEnrichmentCounts(previousId);
		const cmp = evaluateDatasetComparability(current, previous);
		printRun(previous);
		printRun(current);
		console.log(
			cmp.comparable
				? '\nComparable — growth/momentum may be enabled.'
				: `\nNot comparable — ${cmp.growthSuppressedReason}`
		);
		if (cmp.effectiveSampleRatio != null) {
			console.log(`Effective sample ratio: ${cmp.effectiveSampleRatio.toFixed(3)}`);
		}
		if (cmp.enrichmentCoverageDifference != null) {
			console.log(
				`Enrichment coverage difference: ${cmp.enrichmentCoverageDifference.toFixed(3)}`
			);
		}
		console.log('\nTemporal distribution:');
		console.log(
			`  previous: hours=${cmp.previousTemporal.uniqueHoursRepresented}/${previous.expectedShards}  largest-hour-share=${(cmp.previousTemporal.largestHourShare * 100).toFixed(1)}%  entropy=${cmp.previousTemporal.hourlyDistributionEntropy}`
		);
		console.log(
			`  current : hours=${cmp.currentTemporal.uniqueHoursRepresented}/${current.expectedShards}  largest-hour-share=${(cmp.currentTemporal.largestHourShare * 100).toFixed(1)}%  entropy=${cmp.currentTemporal.hourlyDistributionEntropy}`
		);
		console.log(
			`  matched hours=${cmp.matchedHourCount}  matched ratio=${(cmp.matchedHourRatio * 100).toFixed(1)}%  temporal-comparable=${cmp.temporalComparable}`
		);
		if (current.comparisonMode === 'matched-hours') {
			console.log(
				`  completed matched ratio=${(cmp.completedMatchedHourRatio * 100).toFixed(1)}%  partial=${cmp.partialMatchedHours}  max/hour sample difference=${(cmp.maxPerHourSampleDifference * 100).toFixed(1)}%`
			);
			console.log(
				`  label: Matched ${cmp.matchedHourCount}-hour comparison (same UTC offsets; not a full-week estimate)`
			);
		}
		return;
	}

	if (action === 'status' || action === 'list') {
		const runs = listDatasetRuns(20);
		if (runs.length === 0) {
			console.log('No dataset runs yet. Create a pair with:');
			console.log(
				'  DATASET_PREVIOUS_START=... DATASET_PREVIOUS_END=... DATASET_CURRENT_START=... DATASET_CURRENT_END=... npm run dataset:create-pair'
			);
			return;
		}
		for (const run of runs) printRun(run);
		return;
	}

	throw new Error(`Unknown action: ${action}`);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
