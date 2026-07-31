import { describe, expect, it, beforeEach } from 'vitest';
import {
	computeStageTimingPercentiles,
	pushEnrichStageSample,
	resetEnrichTimingSamplesForTests,
	type MetadataPhaseSpans
} from '../src/lib/server/enrichment-stage-timings.js';

function spans(partial: Partial<MetadataPhaseSpans>): MetadataPhaseSpans {
	const base = {
		queueWaitMs: 0,
		rateLimitWaitMs: 0,
		httpConnectTtfbMs: 0,
		bodyReadMs: 0,
		parseMs: 0,
		dbWriteMs: 0,
		postprocessMs: 0,
		...partial
	};
	const operationTotalMs =
		partial.operationTotalMs ??
		base.rateLimitWaitMs +
			base.httpConnectTtfbMs +
			base.bodyReadMs +
			base.parseMs +
			base.postprocessMs +
			base.dbWriteMs;
	return {
		...base,
		operationTotalMs,
		endToEndTotalMs: partial.endToEndTotalMs ?? base.queueWaitMs + operationTotalMs
	};
}

describe('metadata phase span percentiles', () => {
	beforeEach(() => {
		resetEnrichTimingSamplesForTests();
	});

	it('omits metadataDetail when samples lack spans', () => {
		pushEnrichStageSample({
			metadataMs: 11_000,
			classificationMs: 10,
			readmeMs: 0,
			dbWriteMs: 20,
			totalMs: 11_050
		});
		const pct = computeStageTimingPercentiles();
		expect(pct?.metadata.p50).toBe(11_000);
		expect(pct?.metadata.n).toBe(1);
		expect(pct?.metadataDetail).toBeUndefined();
	});

	it('keeps queueWait out of operationTotal and labels both totals', () => {
		for (const sample of [
			spans({
				queueWaitMs: 9_500,
				httpConnectTtfbMs: 300,
				bodyReadMs: 40,
				parseMs: 2,
				dbWriteMs: 80,
				postprocessMs: 10
			}),
			spans({
				queueWaitMs: 10_200,
				httpConnectTtfbMs: 280,
				bodyReadMs: 35,
				parseMs: 1,
				dbWriteMs: 90,
				postprocessMs: 12
			}),
			spans({
				queueWaitMs: 8_800,
				rateLimitWaitMs: 1_000,
				httpConnectTtfbMs: 310,
				bodyReadMs: 50,
				parseMs: 2,
				dbWriteMs: 70,
				postprocessMs: 8
			})
		]) {
			expect(sample.operationTotalMs).toBe(
				sample.rateLimitWaitMs +
					sample.httpConnectTtfbMs +
					sample.bodyReadMs +
					sample.parseMs +
					sample.postprocessMs +
					sample.dbWriteMs
			);
			expect(sample.endToEndTotalMs).toBe(sample.queueWaitMs + sample.operationTotalMs);

			pushEnrichStageSample({
				metadataMs: sample.httpConnectTtfbMs + sample.bodyReadMs + sample.parseMs,
				classificationMs: 5,
				readmeMs: 0,
				dbWriteMs: sample.dbWriteMs,
				totalMs: sample.endToEndTotalMs,
				metadataSpans: sample
			});
		}

		const detail = computeStageTimingPercentiles()?.metadataDetail;
		expect(detail).toBeDefined();
		expect(detail!.sampleCount).toBe(3);
		expect(detail!.queueWait.n).toBe(3);
		expect(detail!.operationTotal.n).toBe(3);
		expect(detail!.endToEndTotal.n).toBe(3);
		expect(detail!.queueWait.p50).toBeGreaterThan(8_000);
		expect(detail!.httpConnectTtfb.p50).toBeLessThan(500);
		expect(detail!.operationTotal.p50).toBeLessThan(detail!.endToEndTotal.p50);
		expect(detail!.rateLimitWait.p95).toBe(1_000);
		expect(detail!.bodyRead.p50).toBeGreaterThan(0);
		expect(detail!.parse.p50).toBeLessThan(10);
	});
});
