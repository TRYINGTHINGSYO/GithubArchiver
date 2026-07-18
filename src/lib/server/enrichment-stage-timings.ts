/**
 * Rolling per-repo enrichment stage samples for avg + percentile ops metrics.
 * Process-local window survives across enrich cycles until the daemon restarts.
 */

export interface StageTimingSample {
	metadataMs: number;
	classificationMs: number;
	readmeMs: number;
	dbWriteMs: number;
	totalMs: number;
}

export interface StagePercentiles {
	p50: number;
	p95: number;
}

export interface StageTimingPercentiles {
	sampleCount: number;
	readmeSampleCount: number;
	storySampleCount: number;
	metadata: StagePercentiles;
	classification: StagePercentiles;
	readme: StagePercentiles;
	story: StagePercentiles;
	dbWrite: StagePercentiles;
	total: StagePercentiles;
}

const DEFAULT_WINDOW = 2_000;

function windowLimit(): number {
	const n = Number(process.env.ENRICH_TIMING_SAMPLE_WINDOW ?? DEFAULT_WINDOW);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_WINDOW;
}

let stageSamples: StageTimingSample[] = [];
let storySamples: number[] = [];

export function resetEnrichTimingSamplesForTests(): void {
	stageSamples = [];
	storySamples = [];
}

export function pushEnrichStageSample(sample: StageTimingSample): void {
	stageSamples.push(sample);
	const limit = windowLimit();
	if (stageSamples.length > limit) {
		stageSamples.splice(0, stageSamples.length - limit);
	}
}

export function pushStoryTimingSamples(durationsMs: number[]): void {
	if (durationsMs.length === 0) return;
	storySamples.push(...durationsMs);
	const limit = windowLimit();
	if (storySamples.length > limit) {
		storySamples.splice(0, storySamples.length - limit);
	}
}

/** Nearest-rank percentile on a copy (does not mutate input). */
export function percentileNearestRank(values: number[], percentile: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const clamped = Math.min(100, Math.max(0, percentile));
	const rank = Math.ceil((clamped / 100) * sorted.length);
	const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
	return sorted[idx];
}

function pair(values: number[]): StagePercentiles {
	return {
		p50: Math.round(percentileNearestRank(values, 50) * 10) / 10,
		p95: Math.round(percentileNearestRank(values, 95) * 10) / 10
	};
}

export function computeStageTimingPercentiles(): StageTimingPercentiles | null {
	if (stageSamples.length === 0 && storySamples.length === 0) return null;

	const readmeOnly = stageSamples.map((s) => s.readmeMs).filter((ms) => ms > 0);

	return {
		sampleCount: stageSamples.length,
		readmeSampleCount: readmeOnly.length,
		storySampleCount: storySamples.length,
		metadata: pair(stageSamples.map((s) => s.metadataMs)),
		classification: pair(stageSamples.map((s) => s.classificationMs)),
		readme: pair(readmeOnly),
		story: pair(storySamples),
		dbWrite: pair(stageSamples.map((s) => s.dbWriteMs)),
		total: pair(stageSamples.map((s) => s.totalMs))
	};
}

export function stagePercentilesToJson(
	percentiles: StageTimingPercentiles | null
): string {
	return JSON.stringify(percentiles ?? {});
}

export function parseStagePercentilesJson(raw: unknown): StageTimingPercentiles | null {
	if (raw == null || raw === '') return null;
	try {
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (!parsed || typeof parsed !== 'object') return null;
		const obj = parsed as Partial<StageTimingPercentiles>;
		if (typeof obj.sampleCount !== 'number' || obj.sampleCount <= 0) return null;
		if (!obj.metadata || !obj.total) return null;
		return obj as StageTimingPercentiles;
	} catch {
		return null;
	}
}
