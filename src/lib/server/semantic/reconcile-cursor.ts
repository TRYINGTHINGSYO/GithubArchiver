/**
 * Persisted keyset cursors for semantic index reconciliation.
 * Guarantees eventual coverage of every indexed/removed state row without OFFSET.
 */
import { getDb } from '../db/connection.js';

export type SemanticReconcileSweepKind = 'indexed' | 'removed';

export function getSemanticReconcileCursor(kind: SemanticReconcileSweepKind): number {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT last_vector_id FROM semantic_reconcile_cursor WHERE sweep_kind = ?`
		)
		.get(kind) as { last_vector_id: number } | undefined;
	return row?.last_vector_id ?? 0;
}

export function setSemanticReconcileCursor(
	kind: SemanticReconcileSweepKind,
	lastVectorId: number
): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO semantic_reconcile_cursor (sweep_kind, last_vector_id, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(sweep_kind) DO UPDATE SET
		   last_vector_id = excluded.last_vector_id,
		   updated_at = excluded.updated_at`
	).run(kind, lastVectorId, now);
}

/**
 * Fetch the next bounded batch of state rows for a sweep, advancing past
 * `afterVectorId`. When the tail is exhausted, wraps to the beginning so every
 * row is eventually visited. Returns the rows examined and the cursor to
 * persist after the cycle (last examined vector_id, or 0 after a full wrap
 * with an empty remainder).
 */
export function nextSemanticReconcileBatch(
	kind: SemanticReconcileSweepKind,
	limit: number,
	afterVectorId: number = getSemanticReconcileCursor(kind)
): { rows: Array<{ entity_key: string; vector_id: number }>; nextCursor: number } {
	const db = getDb();
	const status = kind === 'indexed' ? 'indexed' : 'removed';
	const selectAfter = db.prepare(
		`SELECT entity_key, vector_id FROM semantic_index_state
		 WHERE entity_type = 'repository' AND status = ?
		   AND vector_id > ?
		 ORDER BY vector_id ASC
		 LIMIT ?`
	);
	const selectFromStart = db.prepare(
		`SELECT entity_key, vector_id FROM semantic_index_state
		 WHERE entity_type = 'repository' AND status = ?
		   AND vector_id > 0
		 ORDER BY vector_id ASC
		 LIMIT ?`
	);

	let rows = selectAfter.all(status, afterVectorId, limit) as Array<{
		entity_key: string;
		vector_id: number;
	}>;

	if (rows.length < limit && afterVectorId > 0) {
		const remaining = limit - rows.length;
		const wrapped = selectFromStart.all(status, remaining) as Array<{
			entity_key: string;
			vector_id: number;
		}>;
		// Avoid duplicating ids if the table is smaller than the limit.
		const seen = new Set(rows.map((r) => r.vector_id));
		for (const row of wrapped) {
			if (seen.has(row.vector_id)) continue;
			rows.push(row);
			seen.add(row.vector_id);
		}
	}

	if (rows.length === 0) {
		return { rows: [], nextCursor: 0 };
	}

	const nextCursor = rows[rows.length - 1]!.vector_id;
	return { rows, nextCursor };
}
