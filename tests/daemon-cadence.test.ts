import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	initializeInProcessCadence,
	maybeRunDueEmergingCycle,
	resetDaemonCadenceForTests
} from '$lib/server/daemon-cadence';
import { getScheduledJob, isJobDue } from '$lib/server/db/scheduled-jobs';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('in-process daemon cadence (emerging)', () => {
	beforeEach(() => {
		setupTestDb();
		resetDaemonCadenceForTests();
	});
	afterEach(() => teardownTestDb());

	it('runs emerging once when due then advances next_run_at', async () => {
		initializeInProcessCadence();
		expect(isJobDue('emerging')).toBe(true);

		const first = await maybeRunDueEmergingCycle();
		expect(first.ran).toBe(true);
		expect(first.hadFailure).toBe(false);

		const row = getScheduledJob('emerging');
		expect(row?.status).toBe('success');
		expect(row?.next_run_at).toBeTruthy();
		expect(isJobDue('emerging')).toBe(false);

		const second = await maybeRunDueEmergingCycle();
		expect(second.ran).toBe(false);
	});

	it('skips when shouldSkip is true even if due', async () => {
		initializeInProcessCadence();
		const result = await maybeRunDueEmergingCycle({ shouldSkip: () => true });
		expect(result.ran).toBe(false);
		expect(isJobDue('emerging')).toBe(true);
	});

	it('does not re-grab every loop after a completed never-run pass', async () => {
		initializeInProcessCadence();
		await maybeRunDueEmergingCycle();
		for (let i = 0; i < 5; i++) {
			const again = await maybeRunDueEmergingCycle();
			expect(again.ran).toBe(false);
		}
		expect(getScheduledJob('emerging')?.status).toBe('success');
	});
});
