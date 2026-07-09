import { describe, expect, it } from 'vitest';
import { buildRepoFilters } from '$lib/server/db/repo-query';
import { parseRepoQueryParams } from '$lib/server/repo-search';

describe('repo query feeds', () => {
	it('treats the 100-star feed as a real stars filter', () => {
		const parsed = parseRepoQueryParams(new URL('https://example.com/?feed=new_100_stars'));
		expect(parsed.minStars).toBe(100);

		const filters = buildRepoFilters(parsed);
		expect(filters.clause).toContain('repos.stars >= ?');
		expect(filters.params).toContain(100);
	});

	it('keeps stricter explicit star minimums for the 100-star feed', () => {
		const filters = buildRepoFilters({ feed: 'new_100_stars', minStars: 250 });
		expect(filters.clause).toContain('repos.stars >= ?');
		expect(filters.params).toContain(250);
	});

	it('does not add a stars filter to the plain newest feed', () => {
		const filters = buildRepoFilters({ feed: 'newest' });
		expect(filters.clause).not.toContain('stars >=');
		expect(filters.params).not.toContain(100);
	});
});
