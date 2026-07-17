import { getDb } from './db/connection.js';
import { countRepos, countUnenriched } from './db/repos.js';

export type EnrichmentProgressStatus = 'idle' | 'running' | 'rate_limited' | 'paused';

export interface EnrichmentProgress {
	status: EnrichmentProgressStatus;
	currentRepo: string | null;
	completed: number;
	failed: number;
	remaining: number;
	backlogTotal: number;
	enrichedTotal: number;
	rateLimitResetAt?: string;
	updatedAt: string;
}

const TABLE = 'worker_progress';

function ensureTable(): void {
	const db = getDb();
	db.exec(`
		CREATE TABLE IF NOT EXISTS worker_progress (
			worker_name TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			current_item TEXT,
			completed INTEGER NOT NULL DEFAULT 0,
			failed INTEGER NOT NULL DEFAULT 0,
			remaining INTEGER NOT NULL DEFAULT 0,
			total INTEGER NOT NULL DEFAULT 0,
			enriched_total INTEGER NOT NULL DEFAULT 0,
			detail_json TEXT NOT NULL DEFAULT '{}',
			updated_at TEXT NOT NULL
		);
	`);
}

export function setEnrichmentProgress(
	input: Omit<EnrichmentProgress, 'updatedAt'> & { rateLimitResetAt?: string }
): void {
	ensureTable();
	const db = getDb();
	const updatedAt = new Date().toISOString();
	db.prepare(
		`INSERT INTO worker_progress (
		   worker_name, status, current_item, completed, failed, remaining, total,
		   enriched_total, detail_json, updated_at
		 ) VALUES ('enrich', ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(worker_name) DO UPDATE SET
		   status = excluded.status,
		   current_item = excluded.current_item,
		   completed = excluded.completed,
		   failed = excluded.failed,
		   remaining = excluded.remaining,
		   total = excluded.total,
		   enriched_total = excluded.enriched_total,
		   detail_json = excluded.detail_json,
		   updated_at = excluded.updated_at`
	).run(
		input.status,
		input.currentRepo,
		input.completed,
		input.failed,
		input.remaining,
		input.backlogTotal,
		input.enrichedTotal,
		JSON.stringify({ rateLimitResetAt: input.rateLimitResetAt ?? null }),
		updatedAt
	);
}

export function getEnrichmentProgress(): EnrichmentProgress {
	ensureTable();
	const db = getDb();
	const row = db.prepare(`SELECT * FROM worker_progress WHERE worker_name = 'enrich'`).get() as
		| {
				status: string;
				current_item: string | null;
				completed: number;
				failed: number;
				remaining: number;
				total: number;
				enriched_total: number;
				detail_json: string;
				updated_at: string;
		  }
		| undefined;

	if (!row) {
		const remaining = countUnenriched();
		const total = countRepos();
		return {
			status: remaining > 0 ? 'paused' : 'idle',
			currentRepo: null,
			completed: 0,
			failed: 0,
			remaining,
			backlogTotal: remaining,
			enrichedTotal: total - remaining,
			updatedAt: new Date().toISOString()
		};
	}

	let rateLimitResetAt: string | undefined;
	try {
		const detail = JSON.parse(row.detail_json) as { rateLimitResetAt?: string | null };
		rateLimitResetAt = detail.rateLimitResetAt ?? undefined;
	} catch {
		rateLimitResetAt = undefined;
	}

	return {
		status: row.status as EnrichmentProgressStatus,
		currentRepo: row.current_item,
		completed: row.completed,
		failed: row.failed,
		remaining: row.remaining,
		backlogTotal: row.total,
		enrichedTotal: row.enriched_total,
		rateLimitResetAt,
		updatedAt: row.updated_at
	};
}
