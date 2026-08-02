import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseBirthFeedParams } from '$lib/server/birth-feed';
import { queryBirthFeed } from '$lib/server/db/birth-feed';
import { listJobRuns } from '$lib/server/db/jobs';
import { queryRepos } from '$lib/server/db/repos';
import { boundedInteger, boundedNumber, positiveInteger } from '$lib/server/number-params';
import { parseRepoQueryParams } from '$lib/server/repo-search';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('bounded integer request parameters', () => {
	it('defaults malformed values and clamps valid integers to safe bounds', () => {
		expect(boundedInteger(null, 50, { min: 1, max: 100 })).toBe(50);
		expect(boundedInteger('NaN', 50, { min: 1, max: 100 })).toBe(50);
		expect(boundedInteger('2.5', 50, { min: 1, max: 100 })).toBe(50);
		expect(boundedInteger('1e2', 50, { min: 1, max: 100 })).toBe(50);
		expect(boundedInteger('-5', 50, { min: 1, max: 100 })).toBe(1);
		expect(boundedInteger('500', 50, { min: 1, max: 100 })).toBe(100);
	});

	it('accepts only positive safe integer identifiers', () => {
		expect(positiveInteger('42')).toBe(42);
		expect(positiveInteger('0')).toBeUndefined();
		expect(positiveInteger('-1')).toBeUndefined();
		expect(positiveInteger('1.5')).toBeUndefined();
		expect(positiveInteger('9007199254740992')).toBeUndefined();
	});

	it('bounds finite decimal filters without admitting NaN or infinity', () => {
		expect(boundedNumber('72.5', 55, { min: 0, max: 100 })).toBe(72.5);
		expect(boundedNumber('Infinity', 55, { min: 0, max: 100 })).toBe(55);
		expect(boundedNumber(Number.NaN, 55, { min: 0, max: 100 })).toBe(55);
		expect(boundedNumber(200, 55, { min: 0, max: 100 })).toBe(100);
	});

	it('normalizes repository and birth-feed pagination at the URL boundary', () => {
		const repo = parseRepoQueryParams(
			new URL('http://localhost/search?page=Infinity&per_page=-1')
		);
		expect(repo.page).toBe(1);
		expect(repo.perPage).toBe(50);

		const birthFeed = parseBirthFeedParams(
			new URL('http://localhost/birth-feed?page=1.5&per_page=999999')
		);
		expect(birthFeed.page).toBe(1);
		expect(birthFeed.perPage).toBe(100);
	});
});

describe('defensive database pagination', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('does not pass non-finite pagination values to SQLite', () => {
		const repos = queryRepos({ page: Number.NaN, perPage: Number.POSITIVE_INFINITY });
		expect(repos).toMatchObject({ page: 1, perPage: 50 });

		const birthFeed = queryBirthFeed({ page: Number.NaN, perPage: Number.NEGATIVE_INFINITY });
		expect(birthFeed).toMatchObject({ page: 1, perPage: 50 });

		expect(() => listJobRuns({ limit: Number.NaN, offset: Number.NEGATIVE_INFINITY })).not.toThrow();
	});
});
