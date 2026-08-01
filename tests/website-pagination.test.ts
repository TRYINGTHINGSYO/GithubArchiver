import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordWebsiteVerifyResult, upsertCandidateFromCt } from '$lib/server/db/websites';
import { parseWebsitePage, WEBSITE_PAGE_SIZE } from '$lib/website-pagination';
import { load } from '../src/routes/websites/+page.server';
import { setupTestDb, teardownTestDb } from './helpers/db';

function seedWebsites(count: number) {
	for (let index = 0; index < count; index++) {
		const domain = `page-${String(index).padStart(3, '0')}.dev`;
		upsertCandidateFromCt(domain, domain);
		recordWebsiteVerifyResult(domain, {
			status: 'live',
			httpStatus: 200,
			finalUrl: `https://${domain}/`,
			pageTitle: `Page fixture ${index}`
		});
	}
}

interface WebsitePageResult {
	pageSize: number;
	sites: unknown[];
	page: number;
	totalPages: number;
	total: number;
	allTotal: number;
	hasMore: boolean;
}

async function loadUrl(path: string): Promise<WebsitePageResult> {
	return (await load({
		url: new URL(path, 'http://localhost')
	} as Parameters<typeof load>[0])) as WebsitePageResult;
}

async function expectRedirect(path: string, location: string) {
	try {
		await loadUrl(path);
		throw new Error('expected redirect');
	} catch (error) {
		expect(error).toMatchObject({ status: 307, location });
	}
}

describe('website pagination', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it.each([
		[null, { page: 1, valid: true }],
		['1', { page: 1, valid: true }],
		['2', { page: 2, valid: true }],
		['', { page: 1, valid: false }],
		['1.5', { page: 1, valid: false }],
		['Infinity', { page: 1, valid: false }],
		['-Infinity', { page: 1, valid: false }],
		['NaN', { page: 1, valid: false }],
		['0', { page: 1, valid: false }],
		['-2', { page: 1, valid: false }]
	])('strictly parses page %s', (value, expected) => {
		expect(parseWebsitePage(value)).toEqual(expected);
	});

	it('uses 24 items and returns exact and partial final pages', async () => {
		seedWebsites(WEBSITE_PAGE_SIZE * 2 + 1);
		const first = await loadUrl('/websites');
		const explicitFirst = await loadUrl('/websites?page=1');
		const second = await loadUrl('/websites?page=2');
		const final = await loadUrl('/websites?page=3');

		expect(first.pageSize).toBe(24);
		expect(first.sites).toHaveLength(24);
		expect(explicitFirst.page).toBe(1);
		expect(second.sites).toHaveLength(24);
		expect(second.hasMore).toBe(true);
		expect(final.sites).toHaveLength(1);
		expect(final.page).toBe(3);
		expect(final.totalPages).toBe(3);
		expect(final.hasMore).toBe(false);
	});

	it.each(['', '1.5', 'Infinity', 'NaN', '0', '-2'])(
		'canonically redirects invalid page %s to page one',
		async (value) => {
			seedWebsites(2);
			await expectRedirect(`/websites?page=${encodeURIComponent(value)}`, '/websites');
		}
	);

	it('redirects stale pages to the filtered last page while preserving filters', async () => {
		seedWebsites(49);
		await expectRedirect(
			'/websites?q=Page&category=&sort=rated&page=999',
			'/websites?q=Page&category=&sort=rated&page=3'
		);
	});

	it('preserves a genuine empty filtered result without a stale-page empty state', async () => {
		seedWebsites(3);
		const empty = await loadUrl('/websites?q=missing&page=1&sort=favorites');
		expect(empty.total).toBe(0);
		expect(empty.allTotal).toBe(3);
		expect(empty.sites).toEqual([]);
		expect(empty.page).toBe(1);
		expect(empty.totalPages).toBe(1);

		await expectRedirect(
			'/websites?q=missing&category=Unknown&sort=favorites&page=999',
			'/websites?q=missing&category=Unknown&sort=favorites'
		);
	});
});
