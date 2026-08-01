import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	addRepositoryToCollection,
	addWebsiteToCollection,
	getWebsiteCollectionMembership,
	listCollectionWebsites,
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
	markWebsiteShown,
	pickRandomWebsite,
	recordWebsiteVerifyResult,
	upsertCandidateFromCt
} from '$lib/server/db/websites';
import type { CollectionOwner } from '$lib/server/collection-owner';
import {
	deleteWebsiteRating,
	getWebsiteRatingAggregate,
	upsertWebsiteRating
} from '$lib/server/website-ratings';
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
		db.close();
	});
});

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
});
