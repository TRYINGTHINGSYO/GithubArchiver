import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { getDataReadiness } from '$lib/server/data-readiness';
import { MIN_COMPARABLE_HOUR_COVERAGE, getWindowHourCoverage } from '$lib/server/emerging-topics';
import { setupTestDb, teardownTestDb } from './helpers/db';

const WINDOW_DAYS = 7;
const PERIOD_END = new Date('2026-07-30T00:00:00.000Z');

function hourKeysBetween(start: Date, end: Date): string[] {
	const keys: string[] = [];
	for (let t = start.getTime(); t < end.getTime(); t += 3_600_000) {
		keys.push(new Date(t).toISOString().replace('T', '-').slice(0, 13));
	}
	return keys;
}

function markHoursIngested(keys: string[]): void {
	const stmt = getDb().prepare(
		`INSERT OR REPLACE INTO ingestion_state (hour_key, ingested_at, events, inserted, skipped)
		 VALUES (?, ?, 0, 0, 0)`
	);
	for (const key of keys) stmt.run(key, PERIOD_END.toISOString());
}

describe('readiness growth-comparison gate', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('reports growth suppressed while window hours are under-ingested', () => {
		const readiness = getDataReadiness({ windowDays: WINDOW_DAYS, periodEnd: PERIOD_END });

		expect(readiness.currentWindowHoursExpected).toBe(WINDOW_DAYS * 24);
		expect(readiness.currentWindowHoursProcessed).toBe(0);
		expect(readiness.growthComparisonReady).toBe(false);
		expect(readiness.readinessReasons.some((r) => /Growth comparison is suppressed/.test(r))).toBe(
			true
		);
	});

	it('clears the gate once both windows are fully ingested', () => {
		const currentStart = new Date(PERIOD_END.getTime() - WINDOW_DAYS * 86_400_000);
		const previousStart = new Date(currentStart.getTime() - WINDOW_DAYS * 86_400_000);
		markHoursIngested(hourKeysBetween(previousStart, PERIOD_END));

		// Fresh periodEnd so the 30s readiness cache cannot serve the earlier result.
		const periodEnd = new Date(PERIOD_END.getTime() + 3_600_000);
		const readiness = getDataReadiness({ windowDays: WINDOW_DAYS, periodEnd });

		expect(readiness.growthComparisonReady).toBe(true);
		expect(readiness.readinessReasons.some((r) => /Growth comparison is suppressed/.test(r))).toBe(
			false
		);
	});

	it('shares one hour-coverage implementation with detection', () => {
		const currentStart = new Date(PERIOD_END.getTime() - WINDOW_DAYS * 86_400_000);
		const keys = hourKeysBetween(currentStart, PERIOD_END);
		markHoursIngested(keys.slice(0, 50));

		const coverage = getWindowHourCoverage(currentStart.toISOString(), PERIOD_END.toISOString());
		expect(coverage.hoursExpected).toBe(WINDOW_DAYS * 24);
		expect(coverage.hoursProcessed).toBe(50);
		expect(coverage.ratio).toBeLessThan(MIN_COMPARABLE_HOUR_COVERAGE);
	});
});
