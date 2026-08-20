import { getDb } from '../db/connection.js';
import { readLatestReadmeText } from '../db/fts.js';
import type { RepoRow } from '../db/types.js';
import { getSemanticConfig, isSemanticSearchEnabled } from '../semantic/config.js';
import {
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
	getSemanticIndexState,
	listSemanticWorkBatch,
	markSemanticFailed,
	markSemanticIndexed,
	markSemanticIndexing,
	markSemanticRemoved,
	markSemanticStaleForModelOrVersion,
	upsertSemanticPending,
	countSemanticByStatus
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
}

function eligibleRepos(limit: number): RepoRow[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT * FROM repos
			 WHERE deleted_at IS NULL
			   AND pending_deletion_at IS NULL
			   AND enriched_at IS NOT NULL
			 ORDER BY enriched_at DESC
			 LIMIT ?`
		)
		.all(limit) as RepoRow[];
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
	const repos = eligibleRepos(limit);
	let n = 0;
	for (const repo of repos) {
		const existing = getSemanticIndexState('repository', String(repo.id));
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
		if (
			existing?.status === 'indexed' &&
			existing.fingerprint === fingerprint &&
			existing.embedding_model === config.embeddingModel &&
			existing.document_version === config.documentVersion
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

async function removeDeletedFromIndex(): Promise<number> {
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
	if (rows.length === 0) return 0;
	const ids = rows.map((r) => r.vector_id);
	await semanticWorkerRemove(ids);
	for (const row of rows) {
		markSemanticRemoved('repository', row.entity_key);
	}
	return rows.length;
}

export async function runSemanticIndexCycle(
	opts: {
		batchSize?: number;
		force?: boolean;
		dryRun?: boolean;
		enqueueLimit?: number;
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

	const enqueueLimit = opts.enqueueLimit ?? config.batchSize * 4;
	enqueueMissingRepositories(enqueueLimit);
	const removed = opts.dryRun ? 0 : await removeDeletedFromIndex();

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
			synced: false
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
		for (const item of items) {
			if (failedIds.has(item.vectorId)) {
				const err =
					result.failed.find((f) => f.vectorId === item.vectorId)?.error ??
					'index failed';
				markSemanticFailed(item.entityType, item.entityKey, err);
				failed += 1;
				continue;
			}
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
		await semanticWorkerSync();
	}

	const counts = countSemanticByStatus();
	return {
		skipped: false,
		eligible: (counts.pending ?? 0) + (counts.stale ?? 0) + (counts.failed ?? 0),
		attempted: items.length,
		indexed,
		failed,
		removed,
		synced: items.length > 0
	};
}
