import type { SemanticWorkerHealth } from './client.js';
import { getSemanticConfig, type SemanticConfig } from './config.js';

export type WorkerCompatibilityOk = {
	ok: true;
	config: SemanticConfig;
};

export type WorkerCompatibilityFail = {
	ok: false;
	config: SemanticConfig;
	reason: string;
	mismatchedFields: string[];
};

export type WorkerCompatibilityResult = WorkerCompatibilityOk | WorkerCompatibilityFail;

const STALE_MARK_FIELDS = [
	'modelId',
	'dimensions',
	'vectorBits',
	'semanticDocumentVersion'
] as const;

/**
 * Single definition of "worker is compatible with this app process."
 * HTTP health alone is not enough — model/index metadata must match.
 */
export function checkWorkerCompatibility(
	health: SemanticWorkerHealth | null | undefined,
	config: SemanticConfig = getSemanticConfig()
): WorkerCompatibilityResult {
	if (!health?.ok) {
		return {
			ok: false,
			config,
			reason: 'semantic worker unavailable',
			mismatchedFields: ['ok']
		};
	}

	const mismatchedFields: string[] = [];
	if (health.modelId !== config.embeddingModel) mismatchedFields.push('modelId');
	if (health.dimensions !== config.dimensions) mismatchedFields.push('dimensions');
	if (health.vectorBits !== config.vectorBits) mismatchedFields.push('vectorBits');
	if (health.schemaVersion !== config.indexSchemaVersion) {
		mismatchedFields.push('schemaVersion');
	}
	if (health.semanticDocumentVersion !== config.documentVersion) {
		mismatchedFields.push('semanticDocumentVersion');
	}

	if (mismatchedFields.length > 0) {
		const rebuildHint = mismatchedFields.includes('schemaVersion')
			? ' Run `npm run semantic:rebuild` after aligning worker and app config.'
			: mismatchedFields.includes('semanticDocumentVersion') ||
				  mismatchedFields.includes('modelId') ||
				  mismatchedFields.includes('dimensions') ||
				  mismatchedFields.includes('vectorBits')
				? ' Align SEMANTIC_* env with the worker, then re-index (rebuild if the on-disk index was built with the old settings).'
				: '';
		return {
			ok: false,
			config,
			reason:
				`worker incompatible (${mismatchedFields.join(', ')}): ` +
				`worker={model=${health.modelId}, dim=${health.dimensions}, bits=${health.vectorBits}, ` +
				`schema=${health.schemaVersion}, doc=${health.semanticDocumentVersion}} ` +
				`app={model=${config.embeddingModel}, dim=${config.dimensions}, bits=${config.vectorBits}, ` +
				`schema=${config.indexSchemaVersion}, doc=${config.documentVersion}}.` +
				rebuildHint,
			mismatchedFields
		};
	}

	return { ok: true, config };
}

/**
 * True when a mismatch means existing indexed rows should be marked stale
 * so they re-embed under the app's current document/model settings.
 * Index schemaVersion mismatches require an explicit rebuild instead.
 */
export function compatibilityRequiresStaleMark(
	result: WorkerCompatibilityFail
): boolean {
	return result.mismatchedFields.some((f) =>
		(STALE_MARK_FIELDS as readonly string[]).includes(f)
	);
}

export function compatibilityRequiresRebuild(
	result: WorkerCompatibilityFail
): boolean {
	return result.mismatchedFields.includes('schemaVersion');
}
