import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	addRepositoryToCollection,
	addWebsiteToCollection,
	getRepositoryCollectionMembership,
	getWebsiteCollectionMembership,
	listCollectionWebsites,
	removeRepositoryFromCollection,
	removeWebsiteFromCollection
} from '$lib/server/db/collections';
import { getDb } from '$lib/server/db/connection';
import {
	CURRENT_SCHEMA_VERSION,
	getSchemaVersion,
	repairSchemaDrift,
	runMigrations,
	runMigrationsThrough
} from '$lib/server/db/schema';
import {
	hideWebsiteForOwner,
	markWebsiteShown,
	explainRandomWebsiteSelection,
	pickRandomWebsite,
	recordWebsiteVerifyResult,
	upsertCandidateFromCt
} from '$lib/server/db/websites';
import type { CollectionOwner } from '$lib/server/collection-owner';
import {
	deleteWebsiteRating,
	getUserWebsiteRating,
	getWebsiteRatingAggregate,
	upsertWebsiteRating
} from '$lib/server/website-ratings';
import {
	parseWebsiteRouteDomain,
	websiteVisitHref
} from '$lib/server/website-domain';
import { createTestRepo, setupTestDb, teardownTestDb } from './helpers/db';

const owner: CollectionOwner = {
	owner_type: 'anonymous',
	owner_key: 'anon:550e8400-e29b-41d4-a716-446655440000'
};

function seedLiveWebsite(domain: string, title = 'Example'): void {
	upsertCandidateFromCt(domain, `www.${domain}`);
	recordWebsiteVerifyResult(domain, {
		status: 'live',
		httpStatus: 200,
		finalUrl: `https://${domain}/`,
		pageTitle: title
	});
}

describe('migration 044 website curation', () => {
	it('creates ratings, user state, and polymorphic collection items', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		runMigrations(db);

		expect(CURRENT_SCHEMA_VERSION).toBe(44);
		expect(getSchemaVersion(db)).toBe(44);

		const tables = (
			db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{
				name: string;
			}>
		).map((row) => row.name);
		expect(tables).toEqual(
			expect.arrayContaining(['website_ratings', 'website_user_state', 'collection_items'])
		);

		const domainCols = (
			db.prepare('PRAGMA table_info(candidate_domains)').all() as Array<{ name: string }>
		).map((column) => column.name);
		expect(domainCols).toEqual(
			expect.arrayContaining([
				'rating_sum',
				'rating_count',
				'rating_avg',
				'favorite_count',
				'view_count',
				'random_eligible',
				'quality_score'
			])
		);
		db.close();
	});

	it('backfills collection_items from collection_repositories and repairs drift', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		runMigrationsThrough(db, 43);

		db.prepare(
			`INSERT INTO repos (owner, name, full_name, github_url, event_id, created_at, first_seen_at)
			 VALUES ('acme', 'widget', 'acme/widget', 'https://github.com/acme/widget', 'e1',
			         '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
		).run();
		db.prepare(
			`INSERT INTO collections (owner_type, owner_key, kind, name, slug, created_at, updated_at)
			 VALUES ('anonymous', 'anon:test', 'favorites', 'Favorites', 'favorites', 'now', 'now')`
		).run();
		db.prepare(
			`INSERT INTO collection_repositories (collection_id, repo_id, created_at) VALUES (1, 1, 'now')`
		).run();

		expect(getSchemaVersion(db)).toBe(43);
		runMigrations(db);
		expect(getSchemaVersion(db)).toBe(44);
		const items = db
			.prepare(`SELECT item_type, item_key FROM collection_items`)
			.all() as Array<{ item_type: string; item_key: string }>;
		expect(items).toEqual([{ item_type: 'repository', item_key: '1' }]);

		db.exec(`DROP TABLE collection_items`);
		db.exec(`DROP TABLE website_ratings`);
		expect(repairSchemaDrift(db)).toContain('044:website_curation');

		// Re-running backfill must not duplicate rows.
		const before = (
			db.prepare(`SELECT COUNT(*) AS c FROM collection_items`).get() as { c: number }
		).c;
		migrationBackfillAgain(db);
		const after = (
			db.prepare(`SELECT COUNT(*) AS c FROM collection_items`).get() as { c: number }
		).c;
		expect(after).toBe(before);
		db.close();
	});
});

function migrationBackfillAgain(db: Database.Database): void {
	db.exec(`
		INSERT OR IGNORE INTO collection_items (collection_id, item_type, item_key, created_at)
		SELECT collection_id, 'repository', CAST(repo_id AS TEXT), created_at
		FROM collection_repositories
	`);
}

describe('website ratings and independent favorites', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('upserts, aggregates with Bayesian confidence, and soft-deletes ratings', () => {
		seedLiveWebsite('rate-me.dev', 'Rate Me');
		const other: CollectionOwner = {
			owner_type: 'anonymous',
			owner_key: 'anon:11111111-1111-4111-8111-111111111111'
		};

		upsertWebsiteRating('rate-me.dev', owner, 5, 'Excellent find');
		let aggregate = getWebsiteRatingAggregate('rate-me.dev');
		expect(aggregate.count).toBe(1);
		expect(aggregate.average).toBe(5);
		// One perfect score must not outrank a large sample of strong ratings.
		expect(aggregate.confidenceAverage).toBeGreaterThan(3.5);
		expect(aggregate.confidenceAverage!).toBeLessThan(5);

		upsertWebsiteRating('rate-me.dev', other, 4, null);
		upsertWebsiteRating('rate-me.dev', owner, 3, 'Updated');

		aggregate = getWebsiteRatingAggregate('rate-me.dev');
		expect(aggregate.count).toBe(2);
		expect(aggregate.average).toBe(3.5);
		expect(aggregate.distribution[3]).toBe(1);
		expect(aggregate.distribution[4]).toBe(1);

		const domain = getDb()
			.prepare(
				`SELECT rating_sum, rating_count, rating_avg FROM candidate_domains WHERE registrable_domain = ?`
			)
			.get('rate-me.dev') as { rating_sum: number; rating_count: number; rating_avg: number };
		expect(domain.rating_count).toBe(2);
		expect(domain.rating_sum).toBe(7);

		expect(deleteWebsiteRating('rate-me.dev', owner)).toBe(true);
		expect(getWebsiteRatingAggregate('rate-me.dev').count).toBe(1);
	});

	it('favorites websites independently from repository favorites', () => {
		const repo = createTestRepo();
		getDb()
			.prepare(`UPDATE repos SET homepage = ? WHERE id = ?`)
			.run('https://indie-site.example/', repo.id);
		seedLiveWebsite('indie-site.example', 'Indie');

		addRepositoryToCollection(owner, 'favorites', repo.id);
		expect(getWebsiteCollectionMembership(owner, 'indie-site.example')).toEqual({
			favorites: false,
			watch_later: false
		});

		expect(addWebsiteToCollection(owner, 'favorites', 'indie-site.example').created).toBe(true);
		expect(addWebsiteToCollection(owner, 'favorites', 'indie-site.example').created).toBe(false);
		expect(getWebsiteCollectionMembership(owner, 'indie-site.example').favorites).toBe(true);
		expect(listCollectionWebsites(owner, 'favorites')).toMatchObject([
			{ registrable_domain: 'indie-site.example' }
		]);

		const favoriteCount = (
			getDb()
				.prepare(`SELECT favorite_count FROM candidate_domains WHERE registrable_domain = ?`)
				.get('indie-site.example') as { favorite_count: number }
		).favorite_count;
		expect(favoriteCount).toBe(1);

		removeWebsiteFromCollection(owner, 'favorites', 'indie-site.example');
		expect(getWebsiteCollectionMembership(owner, 'indie-site.example').favorites).toBe(false);
		// Repository favorite remains
		expect(
			(
				getDb()
					.prepare('SELECT COUNT(*) AS c FROM collection_repositories')
					.get() as { c: number }
			).c
		).toBe(1);
	});

	it('dual-writes repository collection membership into collection_items', () => {
		const repo = createTestRepo();
		addRepositoryToCollection(owner, 'favorites', repo.id);
		const row = getDb()
			.prepare(
				`SELECT item_type, item_key FROM collection_items WHERE item_type = 'repository'`
			)
			.get() as { item_type: string; item_key: string };
		expect(row).toEqual({ item_type: 'repository', item_key: String(repo.id) });
	});

	it('keeps dual-write synchronized on unfavorite/delete', () => {
		const repo = createTestRepo();
		addRepositoryToCollection(owner, 'favorites', repo.id);
		expect(removeRepositoryFromCollection(owner, 'favorites', repo.id).removed).toBe(true);
		expect(getRepositoryCollectionMembership(owner, repo.id).favorites).toBe(false);
		expect(
			(
				getDb()
					.prepare(
						`SELECT COUNT(*) AS c FROM collection_items
						 WHERE item_type = 'repository' AND item_key = ?`
					)
					.get(String(repo.id)) as { c: number }
			).c
		).toBe(0);
		expect(
			(
				getDb()
					.prepare('SELECT COUNT(*) AS c FROM collection_repositories')
					.get() as { c: number }
			).c
		).toBe(0);
	});

	it('does not let one owner delete another owner rating', () => {
		seedLiveWebsite('owned.dev', 'Owned');
		const other: CollectionOwner = {
			owner_type: 'anonymous',
			owner_key: 'anon:22222222-2222-4222-8222-222222222222'
		};
		upsertWebsiteRating('owned.dev', owner, 5, 'mine');
		expect(deleteWebsiteRating('owned.dev', other)).toBe(false);
		expect(getUserWebsiteRating('owned.dev', owner)?.rating).toBe(5);
		expect(getWebsiteRatingAggregate('owned.dev').count).toBe(1);
	});

	it('recomputes aggregates correctly across concurrent-style updates', () => {
		seedLiveWebsite('busy.dev', 'Busy');
		const owners: CollectionOwner[] = [
			owner,
			{
				owner_type: 'anonymous',
				owner_key: 'anon:33333333-3333-4333-8333-333333333333'
			},
			{
				owner_type: 'anonymous',
				owner_key: 'anon:44444444-4444-4444-8444-444444444444'
			}
		];
		for (const [index, o] of owners.entries()) {
			upsertWebsiteRating('busy.dev', o, (index % 5) + 1);
		}
		upsertWebsiteRating('busy.dev', owners[0], 5);
		deleteWebsiteRating('busy.dev', owners[1]);
		const aggregate = getWebsiteRatingAggregate('busy.dev');
		expect(aggregate.count).toBe(2);
		const domain = getDb()
			.prepare(
				`SELECT rating_sum, rating_count, rating_avg FROM candidate_domains WHERE registrable_domain = ?`
			)
			.get('busy.dev') as { rating_sum: number; rating_count: number; rating_avg: number };
		expect(domain.rating_count).toBe(aggregate.count);
		expect(domain.rating_sum).toBe(5 + 3);
		expect(aggregate.average).toBe(4);
	});

	it('handles empty random results and excludes hidden/dead/parked sites', () => {
		expect(
			pickRandomWebsite({
				ownerType: owner.owner_type,
				ownerKey: owner.owner_key
			})
		).toBeNull();

		seedLiveWebsite('only.dev', 'Only');
		hideWebsiteForOwner('only.dev', owner.owner_type, owner.owner_key, true);
		expect(
			pickRandomWebsite({
				ownerType: owner.owner_type,
				ownerKey: owner.owner_key
			})
		).toBeNull();

		upsertCandidateFromCt('dead.dev', 'dead.dev');
		recordWebsiteVerifyResult('dead.dev', { status: 'dead', httpStatus: 404 });
		upsertCandidateFromCt('park.dev', 'park.dev');
		recordWebsiteVerifyResult('park.dev', { status: 'parked', httpStatus: 200 });
		expect(
			pickRandomWebsite({
				ownerType: owner.owner_type,
				ownerKey: owner.owner_key,
				excludeShownHours: 0
			})
		).toBeNull();
	});

	it('avoids recently shown websites in random discovery', () => {
		seedLiveWebsite('alpha.dev', 'Alpha');
		seedLiveWebsite('beta.dev', 'Beta');

		markWebsiteShown('alpha.dev', owner.owner_type, owner.owner_key);
		const picks = new Set<string>();
		for (let i = 0; i < 12; i++) {
			const site = pickRandomWebsite({
				ownerType: owner.owner_type,
				ownerKey: owner.owner_key,
				excludeShownHours: 24
			});
			if (site) picks.add(site.registrable_domain);
		}
		expect(picks.has('alpha.dev')).toBe(false);
		expect(picks.has('beta.dev')).toBe(true);
	});

	it('uses the eligibility index without a temporary random-selection sort', () => {
		for (let index = 0; index < 30; index++) {
			seedLiveWebsite(`site-${index}.dev`, `Site ${index}`);
		}

		const plan = explainRandomWebsiteSelection({
			ownerType: owner.owner_type,
			ownerKey: owner.owner_key,
			excludeShownHours: 24
		});
		const planText = plan.details.join('\n');
		expect(plan.sql).not.toMatch(/ORDER\s+BY\s+RANDOM/i);
		expect(planText).not.toMatch(/USE TEMP B-TREE|ORDER BY RANDOM/i);
		expect(planText).toContain('idx_candidate_domains_random');
	});

	it('selects the only eligible row and never generates an out-of-range offset', () => {
		seedLiveWebsite('only-eligible.dev', 'Only eligible');
		const random = vi.spyOn(Math, 'random').mockReturnValue(0.9999999999999999);
		expect(pickRandomWebsite()?.registrable_domain).toBe('only-eligible.dev');
		random.mockRestore();
	});

	it('repeated random selection returns only rows that satisfy every filter', () => {
		for (let index = 0; index < 12; index++) {
			seedLiveWebsite(`eligible-${index}.dev`, `Eligible ${index}`);
			getDb()
				.prepare(`UPDATE candidate_domains SET quality_score = ? WHERE registrable_domain = ?`)
				.run(index / 10, `eligible-${index}.dev`);
		}
		seedLiveWebsite('disabled.dev', 'Disabled');
		getDb()
			.prepare(`UPDATE candidate_domains SET random_eligible = 0 WHERE registrable_domain = ?`)
			.run('disabled.dev');
		hideWebsiteForOwner('eligible-11.dev', owner.owner_type, owner.owner_key, true);

		for (let index = 0; index < 80; index++) {
			const site = pickRandomWebsite({
				ownerType: owner.owner_type,
				ownerKey: owner.owner_key,
				excludeShownHours: 0,
				minQuality: 0.8
			});
			expect(site).not.toBeNull();
			expect(site?.registrable_domain).toMatch(/^eligible-(8|9|10)\.dev$/);
		}
	});
});

describe('website route domain normalization', () => {
	it('normalizes hosts and rejects unsafe params', () => {
		expect(parseWebsiteRouteDomain('Example.COM')).toBe('example.com');
		expect(parseWebsiteRouteDomain('blog.example.com')).toBe('example.com');
		expect(parseWebsiteRouteDomain('example.com:8080')).toBe('example.com');
		expect(parseWebsiteRouteDomain('https://example.com/path')).toBe('example.com');
		expect(parseWebsiteRouteDomain('xn--fsq.com')).toBe('xn--fsq.com');
		expect(parseWebsiteRouteDomain('evil.com/../admin')).toBeNull();
		expect(parseWebsiteRouteDomain('127.0.0.1')).toBeNull();
		expect(parseWebsiteRouteDomain('not a host')).toBeNull();
		expect(parseWebsiteRouteDomain('%E0%A4%A')).toBeNull();
	});

	it('only builds http(s) visit hrefs', () => {
		expect(websiteVisitHref({ final_url: 'http://safe.dev/docs' })).toBe('http://safe.dev/docs');
		expect(websiteVisitHref({ final_url: 'https://safe.dev/docs' })).toBe('https://safe.dev/docs');
		expect(websiteVisitHref({ final_url: 'httpx://unsafe.example/path' })).toBeNull();
		expect(websiteVisitHref({ final_url: 'javascript:alert(1)' })).toBeNull();
		expect(websiteVisitHref({ final_url: 'data:text/plain,unsafe' })).toBeNull();
		expect(websiteVisitHref({ final_url: 'file:///tmp/unsafe' })).toBeNull();
		expect(websiteVisitHref({ final_url: '//unsafe.example/path' })).toBeNull();
		expect(websiteVisitHref({ final_url: 'not a url' })).toBeNull();
		expect(websiteVisitHref({ final_url: '' })).toBeNull();
		expect(websiteVisitHref({ final_url: null })).toBeNull();
	});
});

describe('random website keyboard shortcuts', () => {
	it('ignores shortcuts while focus is in form controls', async () => {
		const { shouldIgnoreRandomShortcutTarget } = await import('$lib/random-website-shortcuts');
		const input = { tagName: 'INPUT', isContentEditable: false, closest: () => null };
		const textarea = { tagName: 'TEXTAREA', isContentEditable: false, closest: () => null };
		const select = { tagName: 'SELECT', isContentEditable: false, closest: () => null };
		const button = { tagName: 'BUTTON', isContentEditable: false, closest: () => null };
		expect(shouldIgnoreRandomShortcutTarget(input as unknown as EventTarget)).toBe(true);
		expect(shouldIgnoreRandomShortcutTarget(textarea as unknown as EventTarget)).toBe(true);
		expect(shouldIgnoreRandomShortcutTarget(select as unknown as EventTarget)).toBe(true);
		expect(shouldIgnoreRandomShortcutTarget(button as unknown as EventTarget)).toBe(false);
		expect(shouldIgnoreRandomShortcutTarget(null)).toBe(false);
	});
});
