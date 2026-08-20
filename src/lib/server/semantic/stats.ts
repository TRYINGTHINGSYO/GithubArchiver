import { getSemanticConfig, isSemanticSearchEnabled } from './config.js';
import { semanticWorkerHealth, semanticWorkerStats } from './client.js';
import { countSemanticByStatus, countSemanticIndexedCurrent } from './index-state.js';

export interface SemanticAdminStats {
	enabled: boolean;
	workerHealthy: boolean;
	embeddingModel: string | null;
	dimensions: number | null;
	vectorBits: number | null;
	indexedCount: number;
	pendingCount: number;
	failedCount: number;
	staleCount: number;
	indexBytes: number | null;
	lastSyncAt: string | null;
	indexSchemaVersion: number;
	semanticDocumentVersion: number;
	workerError?: string;
}

export async function getSemanticAdminStats(): Promise<SemanticAdminStats> {
	const config = getSemanticConfig();
	const counts = countSemanticByStatus();
	const base: SemanticAdminStats = {
		enabled: config.enabled,
		workerHealthy: false,
		embeddingModel: config.embeddingModel,
		dimensions: config.dimensions,
		vectorBits: config.vectorBits,
		indexedCount: countSemanticIndexedCurrent(),
		pendingCount: (counts.pending ?? 0) + (counts.indexing ?? 0),
		failedCount: counts.failed ?? 0,
		staleCount: counts.stale ?? 0,
		indexBytes: null,
		lastSyncAt: null,
		indexSchemaVersion: config.indexSchemaVersion,
		semanticDocumentVersion: config.documentVersion
	};

	if (!isSemanticSearchEnabled()) return base;

	const health = await semanticWorkerHealth();
	if (!health?.ok) {
		return { ...base, workerHealthy: false, workerError: 'worker unavailable' };
	}

	const stats = await semanticWorkerStats();
	return {
		...base,
		workerHealthy: true,
		embeddingModel: stats?.modelId ?? health.modelId,
		dimensions: stats?.dimensions ?? health.dimensions,
		vectorBits: stats?.vectorBits ?? health.vectorBits,
		indexBytes: stats?.indexBytes ?? null,
		lastSyncAt: stats?.lastSyncAt ?? null
	};
}
