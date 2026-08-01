import { getDb } from './connection.js';
import { computeWebsiteBackoffMs, websiteVerifyBackoffBaseMs } from '../website-backoff.js';

export type WebsiteVerifyStatus = 'pending' | 'live' | 'parked' | 'dead' | 'error';

export interface CandidateDomainRow {
	registrable_domain: string;
	source_ct: number;
	source_zone: number;
	first_seen_ct_at: string | null;
	first_seen_zone_at: string | null;
	first_seen_at: string;
	last_seen_at: string;
	sample_hostname: string | null;
	verify_status: WebsiteVerifyStatus;
	http_status: number | null;
	final_url: string | null;
	page_title: string | null;
	verified_at: string | null;
	last_error: string | null;
	verify_attempts: number;
	rating_sum?: number;
	rating_count?: number;
	rating_avg?: number | null;
	favorite_count?: number;
	view_count?: number;
	random_eligible?: number;
	category?: string | null;
	summary?: string | null;
	quality_score?: number | null;
}

export function upsertCandidateFromCt(
	registrableDomain: string,
	sampleHostname: string,
	seenAt: string = new Date().toISOString()
): 'inserted' | 'updated' {
	const db = getDb();
	const existing = db
		.prepare('SELECT registrable_domain FROM candidate_domains WHERE registrable_domain = ?')
		.get(registrableDomain);
	db.prepare(
		`INSERT INTO candidate_domains (
		   registrable_domain, source_ct, source_zone, first_seen_ct_at, first_seen_zone_at,
		   first_seen_at, last_seen_at, sample_hostname, verify_status
		 ) VALUES (?, 1, 0, ?, NULL, ?, ?, ?, 'pending')
		 ON CONFLICT(registrable_domain) DO UPDATE SET
		   source_ct = 1,
		   first_seen_ct_at = COALESCE(candidate_domains.first_seen_ct_at, excluded.first_seen_ct_at),
		   last_seen_at = excluded.last_seen_at,
		   sample_hostname = COALESCE(candidate_domains.sample_hostname, excluded.sample_hostname)`
	).run(registrableDomain, seenAt, seenAt, seenAt, sampleHostname);
	return existing ? 'updated' : 'inserted';
}

export function upsertCandidateFromZone(
	registrableDomain: string,
	sampleHostname: string,
	seenAt: string = new Date().toISOString()
): 'inserted' | 'updated' {
	const db = getDb();
	const existing = db
		.prepare('SELECT registrable_domain FROM candidate_domains WHERE registrable_domain = ?')
		.get(registrableDomain);
	db.prepare(
		`INSERT INTO candidate_domains (
		   registrable_domain, source_ct, source_zone, first_seen_ct_at, first_seen_zone_at,
		   first_seen_at, last_seen_at, sample_hostname, verify_status
		 ) VALUES (?, 0, 1, NULL, ?, ?, ?, ?, 'pending')
		 ON CONFLICT(registrable_domain) DO UPDATE SET
		   source_zone = 1,
		   first_seen_zone_at = COALESCE(candidate_domains.first_seen_zone_at, excluded.first_seen_zone_at),
		   last_seen_at = excluded.last_seen_at,
		   sample_hostname = COALESCE(candidate_domains.sample_hostname, excluded.sample_hostname)`
	).run(registrableDomain, seenAt, seenAt, seenAt, sampleHostname);
	return existing ? 'updated' : 'inserted';
}

export function listPendingVerifyDomains(limit: number, nowMs: number = Date.now()): CandidateDomainRow[] {
	const db = getDb();
	const nowIso = new Date(nowMs).toISOString();
	return db
		.prepare(
			`SELECT c.*
			 FROM candidate_domains c
			 LEFT JOIN website_verify_backoff b ON b.registrable_domain = c.registrable_domain
			 WHERE c.verify_status IN ('pending', 'error', 'dead')
			   AND (b.next_retry_at IS NULL OR b.next_retry_at <= ?)
			 ORDER BY c.first_seen_at ASC
			 LIMIT ?`
		)
		.all(nowIso, limit) as CandidateDomainRow[];
}

export function recordWebsiteVerifyResult(
	registrableDomain: string,
	result: {
		status: WebsiteVerifyStatus;
		httpStatus?: number | null;
		finalUrl?: string | null;
		pageTitle?: string | null;
		error?: string | null;
	}
): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE candidate_domains SET
		   verify_status = ?,
		   http_status = ?,
		   final_url = ?,
		   page_title = ?,
		   verified_at = ?,
		   last_error = ?,
		   verify_attempts = verify_attempts + 1
		 WHERE registrable_domain = ?`
	).run(
		result.status,
		result.httpStatus ?? null,
		result.finalUrl ?? null,
		result.pageTitle ?? null,
		now,
		result.error ?? null,
		registrableDomain
	);

	if (result.status === 'live' || result.status === 'parked') {
		clearWebsiteVerifyBackoff(registrableDomain);
	} else {
		recordWebsiteVerifyFailure(registrableDomain, result.error ?? result.status);
	}
}

export function recordWebsiteVerifyFailure(
	registrableDomain: string,
	error: string,
	nowMs: number = Date.now()
): void {
	const db = getDb();
	const prev = db
		.prepare('SELECT consecutive_failures FROM website_verify_backoff WHERE registrable_domain = ?')
		.get(registrableDomain) as { consecutive_failures: number } | undefined;
	const failures = (prev?.consecutive_failures ?? 0) + 1;
	const backoffMs = computeWebsiteBackoffMs(failures, websiteVerifyBackoffBaseMs());
	const lastFailedAt = new Date(nowMs).toISOString();
	const nextRetryAt = new Date(nowMs + backoffMs).toISOString();
	db.prepare(
		`INSERT INTO website_verify_backoff (
		   registrable_domain, consecutive_failures, last_error, last_failed_at, next_retry_at
		 ) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(registrable_domain) DO UPDATE SET
		   consecutive_failures = excluded.consecutive_failures,
		   last_error = excluded.last_error,
		   last_failed_at = excluded.last_failed_at,
		   next_retry_at = excluded.next_retry_at`
	).run(registrableDomain, failures, error.slice(0, 2000), lastFailedAt, nextRetryAt);
}

export function clearWebsiteVerifyBackoff(registrableDomain: string): void {
	getDb().prepare('DELETE FROM website_verify_backoff WHERE registrable_domain = ?').run(registrableDomain);
}

export type LiveWebsiteSort = 'recent' | 'rated' | 'favorites';

export function listLiveWebsites(
	limit = 50,
	offset = 0,
	sort: LiveWebsiteSort = 'recent'
): CandidateDomainRow[] {
	const orderBy =
		sort === 'rated'
			? `COALESCE(rating_avg, 0) DESC, COALESCE(rating_count, 0) DESC, COALESCE(verified_at, first_seen_at) DESC`
			: sort === 'favorites'
				? `COALESCE(favorite_count, 0) DESC, COALESCE(verified_at, first_seen_at) DESC`
				: `COALESCE(verified_at, first_seen_at) DESC`;
	return getDb()
		.prepare(
			`SELECT * FROM candidate_domains
			 WHERE verify_status = 'live'
			 ORDER BY ${orderBy}
			 LIMIT ? OFFSET ?`
		)
		.all(limit, offset) as CandidateDomainRow[];
}

export function countLiveWebsites(): number {
	const row = getDb()
		.prepare(`SELECT COUNT(*) AS c FROM candidate_domains WHERE verify_status = 'live'`)
		.get() as { c: number };
	return row.c;
}

export function getWebsitePipelineState(key: string): string | null {
	const row = getDb()
		.prepare('SELECT value FROM website_pipeline_state WHERE key = ?')
		.get(key) as { value: string } | undefined;
	return row?.value ?? null;
}

export function setWebsitePipelineState(key: string, value: string): void {
	const now = new Date().toISOString();
	getDb()
		.prepare(
			`INSERT INTO website_pipeline_state (key, value, updated_at) VALUES (?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
		)
		.run(key, value, now);
}

export function getWebsiteByDomain(domain: string): CandidateDomainRow | null {
	const row = getDb()
		.prepare('SELECT * FROM candidate_domains WHERE registrable_domain = ?')
		.get(domain.toLowerCase()) as CandidateDomainRow | undefined;
	return row ?? null;
}

export function listHighestRatedWebsites(limit = 12): CandidateDomainRow[] {
	return getDb()
		.prepare(
			`SELECT * FROM candidate_domains
			 WHERE verify_status = 'live'
			   AND COALESCE(rating_count, 0) > 0
			 ORDER BY COALESCE(rating_avg, 0) DESC, rating_count DESC, verified_at DESC
			 LIMIT ?`
		)
		.all(limit) as CandidateDomainRow[];
}

export function listNewLiveWebsites(limit = 12): CandidateDomainRow[] {
	return listLiveWebsites(limit, 0);
}

export function incrementWebsiteView(domain: string): void {
	getDb()
		.prepare(
			`UPDATE candidate_domains
			 SET view_count = COALESCE(view_count, 0) + 1
			 WHERE registrable_domain = ?`
		)
		.run(domain);
}

export interface RandomWebsiteFilters {
	ownerType?: string;
	ownerKey?: string;
	minQuality?: number;
	excludeShownHours?: number;
	workingOnly?: boolean;
}

/**
 * Pick a random live website, avoiding recently shown / hidden for this owner when provided.
 */
export function pickRandomWebsite(filters: RandomWebsiteFilters = {}): CandidateDomainRow | null {
	const db = getDb();
	const params: (string | number)[] = [];
	const where = [
		`c.verify_status = 'live'`,
		`COALESCE(c.random_eligible, 1) = 1`
	];

	if (filters.workingOnly !== false) {
		where.push(`c.http_status IS NOT NULL AND c.http_status < 400`);
	}
	if (filters.minQuality != null) {
		where.push(`COALESCE(c.quality_score, 0) >= ?`);
		params.push(filters.minQuality);
	}

	if (filters.ownerType && filters.ownerKey) {
		where.push(`NOT EXISTS (
			SELECT 1 FROM website_user_state s
			WHERE s.website_domain = c.registrable_domain
			  AND s.owner_type = ? AND s.owner_key = ?
			  AND s.hidden = 1
		)`);
		params.push(filters.ownerType, filters.ownerKey);

		const hours = filters.excludeShownHours ?? 24;
		if (hours > 0) {
			where.push(`NOT EXISTS (
				SELECT 1 FROM website_user_state s
				WHERE s.website_domain = c.registrable_domain
				  AND s.owner_type = ? AND s.owner_key = ?
				  AND s.last_shown_at IS NOT NULL
				  AND s.last_shown_at > datetime('now', ?)
			)`);
			params.push(filters.ownerType, filters.ownerKey, `-${hours} hours`);
		}
	}

	const row = db
		.prepare(
			`SELECT c.* FROM candidate_domains c
			 WHERE ${where.join(' AND ')}
			 ORDER BY RANDOM()
			 LIMIT 1`
		)
		.get(...params) as CandidateDomainRow | undefined;
	return row ?? null;
}

export function markWebsiteShown(
	domain: string,
	ownerType: string,
	ownerKey: string
): void {
	const now = new Date().toISOString();
	getDb()
		.prepare(
			`INSERT INTO website_user_state
			 (owner_type, owner_key, website_domain, hidden, last_shown_at, shown_count, updated_at)
			 VALUES (?, ?, ?, 0, ?, 1, ?)
			 ON CONFLICT(owner_type, owner_key, website_domain) DO UPDATE SET
			   last_shown_at = excluded.last_shown_at,
			   shown_count = website_user_state.shown_count + 1,
			   updated_at = excluded.updated_at`
		)
		.run(ownerType, ownerKey, domain, now, now);
}

export function hideWebsiteForOwner(
	domain: string,
	ownerType: string,
	ownerKey: string,
	hidden = true
): void {
	const now = new Date().toISOString();
	getDb()
		.prepare(
			`INSERT INTO website_user_state
			 (owner_type, owner_key, website_domain, hidden, last_shown_at, shown_count, updated_at)
			 VALUES (?, ?, ?, ?, NULL, 0, ?)
			 ON CONFLICT(owner_type, owner_key, website_domain) DO UPDATE SET
			   hidden = excluded.hidden,
			   updated_at = excluded.updated_at`
		)
		.run(ownerType, ownerKey, domain, hidden ? 1 : 0, now);
}

/** Link repos whose homepage host matches the website domain (best-effort). */
export function listSourceReposForWebsite(domain: string, limit = 12): Array<{
	id: number;
	full_name: string;
	description: string | null;
	stars: number | null;
	language: string | null;
}> {
	return getDb()
		.prepare(
			`SELECT id, full_name, description, stars, language
			 FROM repos
			 WHERE homepage IS NOT NULL
			   AND (
			     homepage LIKE ?
			     OR homepage LIKE ?
			   )
			   AND deleted_at IS NULL
			   AND pending_deletion_at IS NULL
			 ORDER BY COALESCE(stars, 0) DESC, enriched_at DESC
			 LIMIT ?`
		)
		.all(`%://${domain}%`, `%://${domain}/%`, limit) as Array<{
		id: number;
		full_name: string;
		description: string | null;
		stars: number | null;
		language: string | null;
	}>;
}
