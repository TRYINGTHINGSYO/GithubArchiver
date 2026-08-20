import { getDb } from '../db/connection.js';
import { readLatestReadmeText } from '../db/fts.js';
import type { RepoRow } from '../db/types.js';
import { getSemanticConfig, isSemanticSearchEnabled } from './config.js';
import { semanticWorkerHealth, semanticWorkerSimilar } from './client.js';
import { buildRepositorySemanticDocument } from './document.js';
import { getSemanticIndexState } from './index-state.js';
import { repositoryVectorId } from './ids.js';

export interface SimilarRepoResult {
	repo: RepoRow;
	semanticScore: number;
}

/**
 * Find semantically similar repositories by re-embedding the repo's semantic document
 * and querying TurboVec (excluding the source repo).
 */
export async function findSimilarRepositories(
	repoId: number,
	limit = 8
): Promise<SimilarRepoResult[]> {
	if (!isSemanticSearchEnabled()) return [];
	const health = await semanticWorkerHealth();
	if (!health?.ok) return [];

	const state = getSemanticIndexState('repository', String(repoId));
	if (!state || state.status !== 'indexed') return [];

	const db = getDb();
	const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(repoId) as
		| RepoRow
		| undefined;
	if (!repo || repo.deleted_at || repo.pending_deletion_at) return [];

	const document = buildRepositorySemanticDocument({
		...repo,
		readmeText: readLatestReadmeText(repo.id)
	});

	const k = Math.max(1, Math.min(24, limit + 4));
	let hits: Array<{ vectorId: number; score: number }> = [];
	try {
		hits = await semanticWorkerSimilar({
			query: document,
			vectorId: repositoryVectorId(repoId),
			k
		});
	} catch {
		return [];
	}

	const ids = hits
		.map((h) => h.vectorId)
		.filter((id) => id !== repoId)
		.slice(0, limit);
	if (ids.length === 0) return [];

	const placeholders = ids.map(() => '?').join(', ');
	const rows = db
		.prepare(
			`SELECT * FROM repos
			 WHERE id IN (${placeholders})
			   AND deleted_at IS NULL
			   AND pending_deletion_at IS NULL`
		)
		.all(...ids) as RepoRow[];
	const byId = new Map(rows.map((r) => [r.id, r]));
	const scoreById = new Map(hits.map((h) => [h.vectorId, h.score]));

	const out: SimilarRepoResult[] = [];
	for (const id of ids) {
		const neighbor = byId.get(id);
		if (!neighbor) continue;
		out.push({
			repo: neighbor,
			semanticScore: scoreById.get(id) ?? 0
		});
	}
	return out;
}

export function semanticSimilarEnabled(): boolean {
	return getSemanticConfig().enabled;
}
