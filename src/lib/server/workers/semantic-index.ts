import { getDb } from '../db/connection.js';
import { readLatestReadmeText } from '../db/fts.js';
import type { RepoRow } from '../db/types.js';
import { getSemanticConfig, isSemanticSearchEnabled } from '../semantic/config.js';
import {
	semanticWorkerContains,
	semanticWorkerHealth,
	semanticWorkerIndexBatch,
	semanticWorkerRemove,
	semanticWorkerSync,
	type SemanticIndexItem
} from '../semantic/client.js';
import { buildRepositorySemanticDocument } from '../semantic/document.js';
import { semanticFingerprint } from '../semantic/fingerprint.js';
import { repositoryVectorId } from '../semantic/ids.js';
import {
	countSemanticByStatus,
	getSemanticIndexState,
	listSemanticWorkBatch,
	markSemanticFailed,
	markSemanticIndexed,
	markSemanticIndexing,
	markSemanticRemoved,
	markSemanticStaleForModelOrVersion,
	upsertSemanticPending
} from '../semantic/index-state.js';

export interface SemanticIndexCycleResult {
	skipped: boolean;
	reason?: string;
	eligible: number;
	attempted: number;
	indexed: number;
	failed: number;
	removed: number;
	synced: boolean;
	reconciled?: number;
}

/**
 * Enqueue repositories that are missing a current semantic index row.
 * Uses a LEFT JOIN against semantic_index_state so already-indexed newest
 * repos cannot starve older never-indexed archives (no enriched_at DESC LIMIT trap).
 */
export function listReposNeedingSemanticIndex(limit: number): RepoRow[] {
	const config = getSemanticConfig();
	const db = getDb();
	return db
		.prepare(
			`SELECT r.*
			 FROM repos r
			 LEFT JOIN semantic_index_state s
			   ON s.entity_type = 'repository'
			  AND s.entity_key = CAST(r.id AS TEXT)
			 WHERE r.deleted_at IS NULL
			   AND r.pending_deletion_at IS NULL
			   AND r.enriched_at IS NOT NULL
			   AND (
			     s.entity_key IS NULL
			     OR s.status IN ('pending', 'stale', 'failed', 'indexing', 'removed')
			     OR s.embedding_model IS NULL
			     OR s.embedding_model != ?
			     OR s.document_version IS NULL
			     OR s.document_version != ?
			     OR s.dimensions IS NULL
			     OR s.dimensions != ?
			     OR s.vector_bits IS NULL
			     OR s.vector_bits != ?
			   )
			 ORDER BY r.id ASC
			 LIMIT ?`
		)
		.all(
			config.embeddingModel,
			config.documentVersion,
			config.dimensions,
			config.vectorBits,
			limit
		) as RepoRow[];
}

export function enqueueRepositoryForSemanticIndex(repo: RepoRow): void {
	const config = getSemanticConfig();
	const document = buildRepositorySemanticDocument({
		...repo,
		readmeText: readLatestReadmeText(repo.id)
	});
	const fingerprint = semanticFingerprint({
		entityKey: String(repo.id),
		document,
		embeddingModel: config.embeddingModel,
		documentVersion: config.documentVersion
	});
	upsertSemanticPending({
		entityType: 'repository',
		entityKey: String(repo.id),
		vectorId: repositoryVectorId(repo.id),
		fingerprint
	});
}

export function enqueueMissingRepositories(limit: number): number {
	const repos = listReposNeedingSemanticIndex(limit);
	let n = 0;
	const config = getSemanticConfig();
	for (const repo of repos) {
		const existing = getSemanticIndexState('repository', String(repo.id));
		const document = buildRepositorySemanticDocument({
			...repo,
			readmeText: readLatestReadmeText(repo.id)
		});
		const fingerprint = semanticFingerprint({
			entityKey: String(repo.id),
			document,
			embeddingModel: config.embeddingModel,
			documentVersion: config.documentVersion
		});
		if (
			existing?.status === 'indexed' &&
			existing.fingerprint === fingerprint &&
			existing.embedding_model === config.embeddingModel &&
			existing.document_version === config.documentVersion &&
			existing.dimensions === config.dimensions &&
			existing.vector_bits === config.vectorBits
		) {
			continue;
		}
		upsertSemanticPending({
			entityType: 'repository',
			entityKey: String(repo.id),
			vectorId: repositoryVectorId(repo.id),
			fingerprint
		});
		n += 1;
	}
	return n;
}

/**
 * Remove deleted/hidden repos from TurboVec, durable-sync, then mark SQLite removed.
 * Syncs even when this is a removals-only cycle (no new index items).
 */
export async function removeDeletedFromIndex(): Promise<{
	removed: number;
	synced: boolean;
}> {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT s.entity_key, s.vector_id
			 FROM semantic_index_state s
			 LEFT JOIN repos r ON r.id = CAST(s.entity_key AS INTEGER)
			 WHERE s.entity_type = 'repository'
			   AND s.status IN ('indexed', 'pending', 'stale', 'failed', 'indexing')
			   AND (
			     r.id IS NULL
			     OR r.deleted_at IS NOT NULL
			     OR r.pending_deletion_at IS NOT NULL
			   )`
		)
		.all() as { entity_key: string; vector_id: number }[];
	if (rows.length === 0) return { removed: 0, synced: false };

	const ids = rows.map((r) => r.vector_id);
	await semanticWorkerRemove(ids);
	await semanticWorkerSync();
	for (const row of rows) {
		markSemanticRemoved('repository', row.entity_key);
	}
	return { removed: rows.length, synced: true };
}

/**
 * Repair impossible SQLite ↔ TurboVec states:
 * - SQLite indexed but vector missing → stale (retry)
 * - SQLite removed but vector still present → remove + durable sync
 */
export async function reconcileSemanticIndexState(
	opts: { limit?: number } = {}
): Promise<{ repaired: number; synced: boolean }> {
	const db = getDb();
	const limit = opts.limit ?? 500;
	let repaired = 0;
	let synced = false;

	const indexed = db
		.prepare(
			`SELECT entity_key, vector_id FROM semantic_index_state
			 WHERE entity_type = 'repository' AND status = 'indexed'
			 ORDER BY updated_at ASC
			 LIMIT ?`
		)
		.all(limit) as { entity_key: string; vector_id: number }[];

	if (indexed.length > 0) {
		const check = await semanticWorkerContains(indexed.map((r) => r.vector_id));
		const missing = new Set(check.missing);
		const now = new Date().toISOString();
		for (const row of indexed) {
			if (!missing.has(row.vector_id)) continue;
			db.prepare(
				`UPDATE semantic_index_state
				 SET status = 'stale', updated_at = ?, last_error = ?
				 WHERE entity_type = 'repository' AND entity_key = ?`
			).run(now, 'reconcile: vector missing from TurboVec', row.entity_key);
			repaired += 1;
		}
	}

	const removed = db
		.prepare(
			`SELECT entity_key, vector_id FROM semantic_index_state
			 WHERE entity_type = 'repository' AND status = 'removed'
			 ORDER BY updated_at ASC
			 LIMIT ?`
		)
		.all(limit) as { entity_key: string; vector_id: number }[];

	if (removed.length > 0) {
		const check = await semanticWorkerContains(removed.map((r) => r.vector_id));
		if (check.present.length > 0) {
			await semanticWorkerRemove(check.present);
			await semanticWorkerSync();
			synced = true;
			repaired += check.present.length;
		}
	}

	return { repaired, synced };
}

export async function runSemanticIndexCycle(
	opts: {
		batchSize?: number;
		force?: boolean;
		dryRun?: boolean;
		enqueueLimit?: number;
		skipReconcile?: boolean;
	} = {}
): Promise<SemanticIndexCycleResult> {
	if (!isSemanticSearchEnabled()) {
		return {
			skipped: true,
			reason: 'SEMANTIC_SEARCH_ENABLED is off',
			eligible: 0,
			attempted: 0,
			indexed: 0,
			failed: 0,
			removed: 0,
			synced: false
		};
	}

	const config = getSemanticConfig();
	const health = await semanticWorkerHealth();
	if (!health?.ok) {
		return {
			skipped: true,
			reason: 'semantic worker unavailable',
			eligible: 0,
			attempted: 0,
			indexed: 0,
			failed: 0,
			removed: 0,
			synced: false
		};
	}

	if (
		health.modelId !== config.embeddingModel ||
		health.dimensions !== config.dimensions ||
		health.vectorBits !== config.vectorBits
	) {
		markSemanticStaleForModelOrVersion({
			embeddingModel: config.embeddingModel,
			documentVersion: config.documentVersion,
			dimensions: config.dimensions,
			vectorBits: config.vectorBits
		});
		return {
			skipped: true,
			reason: `worker/model mismatch (worker=${health.modelId}/${health.dimensions}/${health.vectorBits})`,
			eligible: 0,
			attempted: 0,
			indexed: 0,
			failed: 0,
			removed: 0,
			synced: false
		};
	}

	let reconciled = 0;
	let synced = false;

	if (!opts.dryRun && !opts.skipReconcile) {
		const repair = await reconcileSemanticIndexState();
		reconciled = repair.repaired;
		synced = synced || repair.synced;
	}

	const enqueueLimit = opts.enqueueLimit ?? config.batchSize * 4;
	enqueueMissingRepositories(enqueueLimit);

	const removal = opts.dryRun
		? { removed: 0, synced: false }
		: await removeDeletedFromIndex();
	synced = synced || removal.synced;

	const batchSize = opts.batchSize ?? config.batchSize;
	const work = listSemanticWorkBatch(batchSize);
	if (opts.dryRun) {
		return {
			skipped: false,
			eligible: work.length,
			attempted: 0,
			indexed: 0,
			failed: 0,
			removed: 0,
			synced: false,
			reconciled
		};
	}

	const items: SemanticIndexItem[] = [];
	const docsByKey = new Map<string, { fingerprint: string; document: string }>();

	for (const row of work) {
		if (row.entity_type !== 'repository') continue;
		const repoId = Number(row.entity_key);
		const repo = getDb()
			.prepare('SELECT * FROM repos WHERE id = ?')
			.get(repoId) as RepoRow | undefined;
		if (!repo) {
			markSemanticFailed(row.entity_type, row.entity_key, 'repo missing');
			continue;
		}
		const document = buildRepositorySemanticDocument({
			...repo,
			readmeText: readLatestReadmeText(repo.id)
		});
		const fingerprint = semanticFingerprint({
			entityKey: String(repo.id),
			document,
			embeddingModel: config.embeddingModel,
			documentVersion: config.documentVersion
		});
		if (
			!opts.force &&
			row.status === 'indexed' &&
			row.fingerprint === fingerprint
		) {
			continue;
		}
		markSemanticIndexing(row.entity_type, row.entity_key);
		docsByKey.set(row.entity_key, { fingerprint, document });
		items.push({
			vectorId: row.vector_id,
			entityType: row.entity_type,
			entityKey: row.entity_key,
			text: document,
			fingerprint
		});
	}

	let indexed = 0;
	let failed = 0;

	if (items.length > 0) {
		const result = await semanticWorkerIndexBatch(items);
		const failedIds = new Set(result.failed.map((f) => f.vectorId));
		const succeeded = items.filter((item) => !failedIds.has(item.vectorId));

		for (const item of items) {
			if (!failedIds.has(item.vectorId)) continue;
			const err =
				result.failed.find((f) => f.vectorId === item.vectorId)?.error ??
				'index failed';
			markSemanticFailed(item.entityType, item.entityKey, err);
			failed += 1;
		}

		// Durable ordering: upsert → sync → only then mark SQLite indexed.
		// Sync failure leaves rows in `indexing` so the next cycle retries.
		if (succeeded.length > 0) {
			try {
				await semanticWorkerSync();
				synced = true;
				for (const item of succeeded) {
					const meta = docsByKey.get(item.entityKey)!;
					markSemanticIndexed({
						entityType: item.entityType,
						entityKey: item.entityKey,
						fingerprint: meta.fingerprint,
						embeddingModel: config.embeddingModel,
						documentVersion: config.documentVersion,
						dimensions: config.dimensions,
						vectorBits: config.vectorBits
					});
					indexed += 1;
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				for (const item of succeeded) {
					markSemanticFailed(
						item.entityType,
						item.entityKey,
						`sync failed before commit: ${message}`
					);
					failed += 1;
				}
			}
		}
	}

	const counts = countSemanticByStatus();
	return {
		skipped: false,
		eligible: (counts.pending ?? 0) + (counts.stale ?? 0) + (counts.failed ?? 0),
		attempted: items.length,
		indexed,
		failed,
		removed: removal.removed,
		synced,
		reconciled
	};
}
