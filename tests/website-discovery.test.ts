import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import {
	countLiveWebsites,
	listLiveWebsiteCategories,
	listLiveWebsites,
	listPendingVerifyDomains,
	recordWebsiteVerifyResult,
	upsertCandidateFromCt,
	upsertCandidateFromZone
} from '$lib/server/db/websites';
import { reconcileOrphanedJobRuns, startJobRun, getJobRunById } from '$lib/server/db/jobs';
import { toRegistrableDomain, isAllowedWebsiteTld } from '$lib/server/website-domain';
import { looksParked, extractHtmlTitle } from '$lib/server/website-parked';
import { WebsiteFetchTimeoutError, fetchWithTimeout } from '$lib/server/website-fetch';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('website discovery', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => {
		teardownTestDb();
		vi.unstubAllGlobals();
	});

	it('collapses hostnames to registrable eTLD+1', () => {
		expect(toRegistrableDomain('blog.example.com')).toBe('example.com');
		expect(toRegistrableDomain('*.Example.COM')).toBe('example.com');
		expect(toRegistrableDomain('not a host')).toBeNull();
		expect(isAllowedWebsiteTld('foo.io', ['io', 'com'])).toBe(true);
		expect(isAllowedWebsiteTld('foo.xyz', ['io', 'com'])).toBe(false);
	});

	it('dedupes CT + zone onto one candidate row', () => {
		expect(upsertCandidateFromCt('example.com', 'blog.example.com')).toBe('inserted');
		expect(upsertCandidateFromZone('example.com', 'example.com')).toBe('updated');
		const row = getDb()
			.prepare('SELECT * FROM candidate_domains WHERE registrable_domain = ?')
			.get('example.com') as {
			source_ct: number;
			source_zone: number;
			verify_status: string;
		};
		expect(row.source_ct).toBe(1);
		expect(row.source_zone).toBe(1);
		expect(row.verify_status).toBe('pending');
	});

	it('only live domains appear on the public list', () => {
		upsertCandidateFromCt('live.example', 'live.example');
		upsertCandidateFromCt('park.example', 'park.example');
		// Force allowed-looking names in DB directly for status coverage
		getDb()
			.prepare(
				`INSERT INTO candidate_domains (
				   registrable_domain, source_ct, source_zone, first_seen_at, last_seen_at, verify_status
				 ) VALUES
				 ('alpha.com', 1, 0, '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z', 'pending'),
				 ('beta.com', 1, 0, '2026-07-30T00:00:00.000Z', '2026-07-30T00:00:00.000Z', 'pending')`
			)
			.run();

		recordWebsiteVerifyResult('alpha.com', {
			status: 'live',
			httpStatus: 200,
			finalUrl: 'https://alpha.com/',
			pageTitle: 'Alpha'
		});
		recordWebsiteVerifyResult('beta.com', {
			status: 'parked',
			httpStatus: 200,
			finalUrl: 'https://sedoparking.com/beta.com',
			pageTitle: 'Parked Domain'
		});

		expect(countLiveWebsites()).toBe(1);
		expect(listLiveWebsites(10).map((r) => r.registrable_domain)).toEqual(['alpha.com']);
		expect(listPendingVerifyDomains(10).some((r) => r.registrable_domain === 'alpha.com')).toBe(
			false
		);
	});

	it('filters and sorts the website selector without losing structural totals', () => {
		for (const [domain, title] of [
			['alpha.dev', 'Alpha Docs'],
			['beta.dev', 'Beta Studio'],
			['gamma.dev', 'Gamma Learn']
		] as const) {
			upsertCandidateFromCt(domain, domain);
			recordWebsiteVerifyResult(domain, {
				status: 'live',
				httpStatus: 200,
				finalUrl: `https://${domain}/`,
				pageTitle: title
			});
		}

		const db = getDb();
		db.prepare(
			`UPDATE candidate_domains
			 SET category = ?, summary = ?, rating_avg = ?, rating_count = ?, favorite_count = ?
			 WHERE registrable_domain = ?`
		).run('Documentation', 'API reference and examples', 4.8, 5, 2, 'alpha.dev');
		db.prepare(
			`UPDATE candidate_domains
			 SET category = ?, summary = ?, rating_avg = ?, rating_count = ?, favorite_count = ?
			 WHERE registrable_domain = ?`
		).run('Design', 'Design tools', 5, 1, 8, 'beta.dev');
		db.prepare(
			`UPDATE candidate_domains
			 SET category = ?, summary = ?, rating_avg = ?, rating_count = ?, favorite_count = ?
			 WHERE registrable_domain = ?`
		).run('Documentation', 'Learning guides', 3.5, 2, 1, 'gamma.dev');

		expect(countLiveWebsites({ query: 'api' })).toBe(1);
		expect(listLiveWebsites(10, 0, 'recent', { query: 'ALPHA' }).map((site) => site.registrable_domain)).toEqual([
			'alpha.dev'
		]);
		expect(countLiveWebsites({ category: 'Documentation' })).toBe(2);
		expect(listLiveWebsites(10, 0, 'rated').map((site) => site.registrable_domain)).toEqual([
			'beta.dev',
			'alpha.dev',
			'gamma.dev'
		]);
		expect(listLiveWebsites(10, 0, 'favorites').map((site) => site.registrable_domain)).toEqual([
			'beta.dev',
			'alpha.dev',
			'gamma.dev'
		]);
		expect(listLiveWebsiteCategories()).toEqual([
			{ category: 'Documentation', count: 2 },
			{ category: 'Design', count: 1 }
		]);
	});

	it('detects parked titles and parking hosts', () => {
		expect(looksParked({ title: 'Buy this domain — HugeDomains' })).toBe(true);
		expect(looksParked({ finalUrl: 'https://sedoparking.com/x', title: 'Welcome' })).toBe(true);
		expect(looksParked({ title: 'Acme Docs', bodySample: '<html>real docs</html>' })).toBe(false);
		expect(extractHtmlTitle('<html><title> Hello </title></html>')).toBe('Hello');
	});

	it('fetchWithTimeout aborts hung requests', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
				return new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => {
						const err = new Error('aborted');
						err.name = 'AbortError';
						reject(err);
					});
				});
			})
		);
		await expect(
			fetchWithTimeout('https://example.test/hang', { timeoutMs: 30 })
		).rejects.toBeInstanceOf(WebsiteFetchTimeoutError);
	});

	it('orphan reconcile covers website_* job types without special casing', () => {
		const nowMs = Date.parse('2026-07-30T20:00:00.000Z');
		const id = startJobRun('website_verify', { phase: 'liveness' });
		getDb()
			.prepare(`UPDATE job_runs SET started_at = ? WHERE id = ?`)
			.run(new Date(nowMs - 20 * 60_000).toISOString(), id);
		expect(reconcileOrphanedJobRuns(10 * 60_000, nowMs)).toBe(1);
		expect(getJobRunById(id)?.status).toBe('interrupted');
	});
});
