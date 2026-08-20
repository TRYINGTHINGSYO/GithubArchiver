import {
	SEMANTIC_ALLOWLIST_SOFT_MAX,
	SEMANTIC_DEFAULT_DIMENSIONS,
	SEMANTIC_DOCUMENT_VERSION,
	SEMANTIC_INDEX_SCHEMA_VERSION
} from './constants.js';

function envFlag(name: string, fallback = false): boolean {
	const raw = process.env[name]?.trim().toLowerCase();
	if (raw === undefined || raw === '') return fallback;
	return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function envNumber(name: string, fallback: number): number {
	const n = Number(process.env[name] ?? fallback);
	return Number.isFinite(n) ? n : fallback;
}

function envString(name: string, fallback: string): string {
	const raw = process.env[name]?.trim();
	return raw && raw.length > 0 ? raw : fallback;
}

export type SemanticSearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface SemanticConfig {
	enabled: boolean;
	indexPath: string;
	workerUrl: string;
	embeddingProvider: 'hashing' | 'sentence-transformers';
	embeddingModel: string;
	dimensions: number;
	vectorBits: 2 | 3 | 4;
	semanticWeight: number;
	lexicalWeight: number;
	qualityWeight: number;
	batchSize: number;
	allowlistSoftMax: number;
	documentVersion: number;
	indexSchemaVersion: number;
	defaultMode: SemanticSearchMode;
	requestTimeoutMs: number;
}

export function getSemanticConfig(): SemanticConfig {
	const bits = envNumber('SEMANTIC_VECTOR_BITS', 2);
	const vectorBits: 2 | 3 | 4 = bits === 3 || bits === 4 ? bits : 2;
	const providerRaw = envString('SEMANTIC_EMBEDDING_PROVIDER', 'hashing');
	const embeddingProvider =
		providerRaw === 'sentence-transformers' || providerRaw === 'local'
			? 'sentence-transformers'
			: 'hashing';
	const defaultModeRaw = envString('SEMANTIC_SEARCH_DEFAULT_MODE', 'keyword');
	const defaultMode: SemanticSearchMode =
		defaultModeRaw === 'semantic' || defaultModeRaw === 'hybrid'
			? defaultModeRaw
			: 'keyword';

	return {
		enabled: envFlag('SEMANTIC_SEARCH_ENABLED', false),
		indexPath: envString('SEMANTIC_INDEX_PATH', './data/semantic/index.tvim'),
		workerUrl: envString('SEMANTIC_WORKER_URL', 'http://127.0.0.1:8791'),
		embeddingProvider,
		embeddingModel: envString(
			'SEMANTIC_EMBEDDING_MODEL',
			embeddingProvider === 'sentence-transformers'
				? 'sentence-transformers/all-MiniLM-L6-v2'
				: 'hashing-v1'
		),
		dimensions: envNumber('SEMANTIC_EMBEDDING_DIMS', SEMANTIC_DEFAULT_DIMENSIONS),
		vectorBits,
		semanticWeight: envNumber('SEMANTIC_SEARCH_WEIGHT', 0.55),
		lexicalWeight: envNumber('SEMANTIC_LEXICAL_WEIGHT', 0.35),
		qualityWeight: envNumber('SEMANTIC_QUALITY_WEIGHT', 0.1),
		batchSize: Math.max(1, Math.floor(envNumber('SEMANTIC_INDEX_BATCH_SIZE', 64))),
		allowlistSoftMax: Math.max(
			100,
			Math.floor(envNumber('SEMANTIC_ALLOWLIST_SOFT_MAX', SEMANTIC_ALLOWLIST_SOFT_MAX))
		),
		documentVersion: SEMANTIC_DOCUMENT_VERSION,
		indexSchemaVersion: SEMANTIC_INDEX_SCHEMA_VERSION,
		defaultMode,
		requestTimeoutMs: Math.max(250, Math.floor(envNumber('SEMANTIC_WORKER_TIMEOUT_MS', 8_000)))
	};
}

export function isSemanticSearchEnabled(): boolean {
	return getSemanticConfig().enabled;
}

export function parseSearchMode(
	raw: string | null | undefined,
	fallback: SemanticSearchMode = 'keyword'
): SemanticSearchMode {
	if (raw === 'semantic' || raw === 'hybrid' || raw === 'keyword') return raw;
	return fallback;
}
