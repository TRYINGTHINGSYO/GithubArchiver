import type { CollectionOwner } from '$lib/server/collection-owner';
import { canonicalizeCollectionOwner } from '$lib/server/collection-owner';
import { getDb } from './db/connection';

export interface WebsiteRatingRow {
	id: number;
	website_domain: string;
	owner_type: string;
	owner_key: string;
	rating: number;
	review: string | null;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface WebsiteRatingAggregate {
	average: number | null;
	count: number;
	distribution: Record<1 | 2 | 3 | 4 | 5, number>;
	/** Bayesian average toward prior 3.5 with strength 10. */
	confidenceAverage: number | null;
}

export interface PublicWebsiteReview {
	rating: number;
	review: string;
	updated_at: string;
}

export const WEBSITE_REVIEW_MAX_LENGTH = 2000;

function owner(collectionOwner: CollectionOwner): CollectionOwner {
	return canonicalizeCollectionOwner(collectionOwner);
}

function normalizeReview(review?: string | null): string | null {
	if (review == null) return null;
	const trimmed = String(review).trim();
	if (!trimmed) return null;
	if (trimmed.length > WEBSITE_REVIEW_MAX_LENGTH) {
		throw new Error(`Review must be at most ${WEBSITE_REVIEW_MAX_LENGTH} characters`);
	}
	return trimmed;
}

function recomputeDomainAggregate(domain: string): void {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT COALESCE(SUM(rating), 0) AS rating_sum,
			        COUNT(*) AS rating_count,
			        AVG(rating) AS rating_avg
			 FROM website_ratings
			 WHERE website_domain = ? AND deleted_at IS NULL`
		)
		.get(domain) as { rating_sum: number; rating_count: number; rating_avg: number | null };

	db.prepare(
		`UPDATE candidate_domains
		 SET rating_sum = ?, rating_count = ?, rating_avg = ?
		 WHERE registrable_domain = ?`
	).run(
		row.rating_sum,
		row.rating_count,
		row.rating_count > 0 ? row.rating_avg : null,
		domain
	);
}

export function getWebsiteRatingAggregate(domain: string): WebsiteRatingAggregate {
	const db = getDb();
	const counts = db
		.prepare(
			`SELECT rating, COUNT(*) AS c
			 FROM website_ratings
			 WHERE website_domain = ? AND deleted_at IS NULL
			 GROUP BY rating`
		)
		.all(domain) as Array<{ rating: number; c: number }>;

	const distribution: WebsiteRatingAggregate['distribution'] = {
		1: 0,
		2: 0,
		3: 0,
		4: 0,
		5: 0
	};
	let sum = 0;
	let count = 0;
	for (const row of counts) {
		const rating = row.rating as 1 | 2 | 3 | 4 | 5;
		if (rating >= 1 && rating <= 5) {
			distribution[rating] = row.c;
			sum += rating * row.c;
			count += row.c;
		}
	}

	const average = count > 0 ? Math.round((sum / count) * 100) / 100 : null;
	const prior = 3.5;
	const strength = 10;
	const confidenceAverage =
		count > 0
			? Math.round(((sum + prior * strength) / (count + strength)) * 100) / 100
			: null;

	return { average, count, distribution, confidenceAverage };
}

export function getUserWebsiteRating(
	domain: string,
	collectionOwner: CollectionOwner
): WebsiteRatingRow | null {
	const o = owner(collectionOwner);
	const row = getDb()
		.prepare(
			`SELECT * FROM website_ratings
			 WHERE website_domain = ? AND owner_type = ? AND owner_key = ? AND deleted_at IS NULL`
		)
		.get(domain, o.owner_type, o.owner_key) as WebsiteRatingRow | undefined;
	return row ?? null;
}

/**
 * Upsert the caller's rating only (owner-scoped). Aggregate recompute runs in the
 * same SQLite transaction so concurrent writers cannot leave stale counts.
 */
export function upsertWebsiteRating(
	domain: string,
	collectionOwner: CollectionOwner,
	rating: number,
	review?: string | null
): WebsiteRatingRow {
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
		throw new Error('Rating must be an integer from 1 to 5');
	}
	const o = owner(collectionOwner);
	const normalizedReview = normalizeReview(review);
	const now = new Date().toISOString();
	const db = getDb();
	db.transaction(() => {
		db.prepare(
			`INSERT INTO website_ratings
			 (website_domain, owner_type, owner_key, rating, review, created_at, updated_at, deleted_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
			 ON CONFLICT(website_domain, owner_type, owner_key) DO UPDATE SET
			   rating = excluded.rating,
			   review = excluded.review,
			   updated_at = excluded.updated_at,
			   deleted_at = NULL`
		).run(domain, o.owner_type, o.owner_key, rating, normalizedReview, now, now);
		recomputeDomainAggregate(domain);
	})();
	const row = getUserWebsiteRating(domain, o);
	if (!row) throw new Error('Failed to persist website rating');
	return row;
}

/** Soft-delete only the caller's active rating for this domain. */
export function deleteWebsiteRating(
	domain: string,
	collectionOwner: CollectionOwner
): boolean {
	const o = owner(collectionOwner);
	const now = new Date().toISOString();
	const db = getDb();
	let removed = false;
	db.transaction(() => {
		const result = db
			.prepare(
				`UPDATE website_ratings
				 SET deleted_at = ?, updated_at = ?
				 WHERE website_domain = ? AND owner_type = ? AND owner_key = ? AND deleted_at IS NULL`
			)
			.run(now, now, domain, o.owner_type, o.owner_key);
		removed = result.changes > 0;
		if (removed) recomputeDomainAggregate(domain);
	})();
	return removed;
}

export function listRecentWebsiteReviews(domain: string, limit = 20): PublicWebsiteReview[] {
	return getDb()
		.prepare(
			`SELECT rating, review, updated_at FROM website_ratings
			 WHERE website_domain = ?
			   AND deleted_at IS NULL
			   AND review IS NOT NULL
			   AND TRIM(review) != ''
			 ORDER BY updated_at DESC
			 LIMIT ?`
		)
		.all(domain, limit) as PublicWebsiteReview[];
}
