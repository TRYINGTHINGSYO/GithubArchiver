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

export function listLiveWebsites(limit = 50, offset = 0): CandidateDomainRow[] {
	return getDb()
		.prepare(
			`SELECT * FROM candidate_domains
			 WHERE verify_status = 'live'
			 ORDER BY COALESCE(verified_at, first_seen_at) DESC
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
