import { afterEach, describe, expect, it } from 'vitest';
import {
	cached,
	clearTtlCacheForTests,
	getTtlCacheStats
} from '$lib/server/ttl-cache';

describe('ttl-cache stats', () => {
	afterEach(() => clearTtlCacheForTests());

	it('tracks hit/miss rates and groups homepage vs cluster keys', () => {
		let readinessComputes = 0;
		let clusterComputes = 0;

		const readiness = () =>
			cached('data-readiness:7:1:250:50', 60_000, () => {
				readinessComputes += 1;
				return { ok: true };
			});
		const clusters = () =>
			cached('cluster-analytics', 60_000, () => {
				clusterComputes += 1;
				return [1, 2, 3];
			});

		readiness();
		readiness();
		readiness();
		clusters();
		clusters();

		expect(readinessComputes).toBe(1);
		expect(clusterComputes).toBe(1);

		const stats = getTtlCacheStats();
		const homepage = stats.groups.find((g) => g.label === 'Homepage');
		const cluster = stats.groups.find((g) => g.label === 'Cluster');
		expect(homepage).toBeTruthy();
		expect(cluster).toBeTruthy();
		expect(homepage!.hits).toBe(2);
		expect(homepage!.misses).toBe(1);
		expect(homepage!.hitRatePercent).toBe(66.7);
		expect(cluster!.hits).toBe(1);
		expect(cluster!.misses).toBe(1);
		expect(cluster!.hitRatePercent).toBe(50);
		expect(stats.total.lookups).toBe(5);
		expect(homepage!.averageTtlAgeSeconds).not.toBeNull();
	});
});
