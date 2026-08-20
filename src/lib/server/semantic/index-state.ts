import { getDb } from '../db/connection.js';
import { getSemanticConfig } from './config.js';
import type { SemanticEntityType } from './ids.js';

export type SemanticIndexStatus =
	| 'pending'
	| 'indexing'
	| 'indexed'
	| 'failed'
	| 'stale'
	| 'removed';

export interface SemanticIndexStateRow {
	entity_type: SemanticEntityType;
	entity_key: string;
	vector_id: number;
	status: SemanticIndexStatus;
	fingerprint: string | null;
	embedding_model: string | null;
	document_version: number | null;
	dimensions: number | null;
	vector_bits: number | null;
	indexed_at: string | null;
	updated_at: string;
	last_error: string | null;
	attempts: number;
}

export function upsertSemanticPending(opts: {
	entityType: SemanticEntityType;
	entityKey: string;
	vectorId: number;
	fingerprint: string;
}): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO semantic_index_state (
		   entity_type, entity_key, vector_id, status, fingerprint,
		   embedding_model, document_version, dimensions, vector_bits,
		   indexed_at, updated_at, last_error, attempts
		 ) VALUES (?, ?, ?, 'pending', ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, 0)
		 ON CONFLICT(entity_type, entity_key) DO UPDATE SET
		   vector_id = excluded.vector_id,
		   fingerprint = excluded.fingerprint,
		   status = CASE
		     WHEN semantic_index_state.fingerprint = excluded.fingerprint
		          AND semantic_index_state.status = 'indexed'
		       THEN 'indexed'
		     ELSE 'pending'
		   END,
		   updated_at = excluded.updated_at,
		   last_error = CASE
		     WHEN semantic_index_state.fingerprint = excluded.fingerprint
		          AND semantic_index_state.status = 'indexed'
		       THEN semantic_index_state.last_error
		     ELSE NULL
		   END`
	).run(opts.entityType, opts.entityKey, opts.vectorId, opts.fingerprint, now);
}

export function markSemanticIndexing(entityType: SemanticEntityType, entityKey: string): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE semantic_index_state
		 SET status = 'indexing', updated_at = ?, attempts = attempts + 1
		 WHERE entity_type = ? AND entity_key = ?`
	).run(now, entityType, entityKey);
}

export function markSemanticIndexed(opts: {
	entityType: SemanticEntityType;
	entityKey: string;
	fingerprint: string;
	embeddingModel: string;
	documentVersion: number;
	dimensions: number;
	vectorBits: number;
}): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE semantic_index_state
		 SET status = 'indexed',
		     fingerprint = ?,
		     embedding_model = ?,
		     document_version = ?,
		     dimensions = ?,
		     vector_bits = ?,
		     indexed_at = ?,
		     updated_at = ?,
		     last_error = NULL
		 WHERE entity_type = ? AND entity_key = ?`
	).run(
		opts.fingerprint,
		opts.embeddingModel,
		opts.documentVersion,
		opts.dimensions,
		opts.vectorBits,
		now,
		now,
		opts.entityType,
		opts.entityKey
	);
}

export function markSemanticFailed(
	entityType: SemanticEntityType,
	entityKey: string,
	error: string
): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE semantic_index_state
		 SET status = 'failed', last_error = ?, updated_at = ?
		 WHERE entity_type = ? AND entity_key = ?`
	).run(error.slice(0, 500), now, entityType, entityKey);
}

export function markSemanticRemoved(entityType: SemanticEntityType, entityKey: string): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE semantic_index_state
		 SET status = 'removed', updated_at = ?, last_error = NULL
		 WHERE entity_type = ? AND entity_key = ?`
	).run(now, entityType, entityKey);
}

export function markSemanticStaleForModelOrVersion(opts: {
	embeddingModel: string;
	documentVersion: number;
	dimensions: number;
	vectorBits: number;
}): number {
	const db = getDb();
	const now = new Date().toISOString();
	const result = db
		.prepare(
			`UPDATE semantic_index_state
			 SET status = 'stale', updated_at = ?
			 WHERE status IN ('indexed', 'failed', 'pending', 'indexing')
			   AND (
			     embedding_model IS NULL
			     OR embedding_model != ?
			     OR document_version IS NULL
			     OR document_version != ?
			     OR dimensions IS NULL
			     OR dimensions != ?
			     OR vector_bits IS NULL
			     OR vector_bits != ?
			   )`
		)
		.run(
			now,
			opts.embeddingModel,
			opts.documentVersion,
			opts.dimensions,
			opts.vectorBits
		);
	return result.changes;
}

export function getSemanticIndexState(
	entityType: SemanticEntityType,
	entityKey: string
): SemanticIndexStateRow | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT * FROM semantic_index_state WHERE entity_type = ? AND entity_key = ?`
		)
		.get(entityType, entityKey) as SemanticIndexStateRow | undefined;
	return row ?? null;
}

export function listSemanticWorkBatch(limit: number): SemanticIndexStateRow[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT * FROM semantic_index_state
			 WHERE status IN ('pending', 'stale', 'failed')
			 ORDER BY
			   CASE status
			     WHEN 'stale' THEN 0
			     WHEN 'pending' THEN 1
			     ELSE 2
			   END,
			   updated_at ASC
			 LIMIT ?`
		)
		.all(limit) as SemanticIndexStateRow[];
}

export function countSemanticByStatus(): Record<string, number> {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT status, COUNT(*) AS c FROM semantic_index_state GROUP BY status`
		)
		.all() as { status: string; c: number }[];
	const out: Record<string, number> = {};
	for (const row of rows) out[row.status] = row.c;
	return out;
}

export function countSemanticIndexedCurrent(): number {
	const config = getSemanticConfig();
	const db = getDb();
	const row = db
		.prepare(
			`SELECT COUNT(*) AS c FROM semantic_index_state
			 WHERE status = 'indexed'
			   AND embedding_model = ?
			   AND document_version = ?
			   AND dimensions = ?
			   AND vector_bits = ?`
		)
		.get(
			config.embeddingModel,
			config.documentVersion,
			config.dimensions,
			config.vectorBits
		) as { c: number };
	return row.c;
}
