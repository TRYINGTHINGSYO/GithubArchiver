import { getSemanticConfig } from './config.js';
import type { SemanticEntityType } from './ids.js';

export interface SemanticWorkerHealth {
	ok: boolean;
	modelId: string;
	dimensions: number;
	vectorBits: number;
	indexedCount: number;
	indexPath: string;
	schemaVersion: number;
	semanticDocumentVersion: number;
	calibrationState?: string;
}

export interface SemanticSearchHit {
	vectorId: number;
	score: number;
}

export interface SemanticIndexItem {
	vectorId: number;
	entityType: SemanticEntityType;
	entityKey: string;
	text: string;
	fingerprint: string;
}

export interface SemanticWorkerStats {
	ok: boolean;
	indexedCount: number;
	dimensions: number;
	vectorBits: number;
	modelId: string;
	indexPath: string;
	indexBytes: number | null;
	lastSyncAt: string | null;
	schemaVersion: number;
	semanticDocumentVersion: number;
}

async function workerFetch(
	path: string,
	init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
	const config = getSemanticConfig();
	const timeoutMs = init?.timeoutMs ?? config.requestTimeoutMs;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(`${config.workerUrl}${path}`, {
			...init,
			signal: controller.signal,
			headers: {
				'content-type': 'application/json',
				...(init?.headers ?? {})
			}
		});
	} finally {
		clearTimeout(timer);
	}
}

export async function semanticWorkerHealth(): Promise<SemanticWorkerHealth | null> {
	try {
		const res = await workerFetch('/health', { method: 'GET', timeoutMs: 2_000 });
		if (!res.ok) return null;
		return (await res.json()) as SemanticWorkerHealth;
	} catch {
		return null;
	}
}

export async function semanticWorkerStats(): Promise<SemanticWorkerStats | null> {
	try {
		const res = await workerFetch('/stats', { method: 'GET', timeoutMs: 3_000 });
		if (!res.ok) return null;
		return (await res.json()) as SemanticWorkerStats;
	} catch {
		return null;
	}
}

export async function semanticWorkerSearch(opts: {
	query: string;
	k: number;
	allowlist?: number[];
}): Promise<SemanticSearchHit[]> {
	const res = await workerFetch('/search', {
		method: 'POST',
		body: JSON.stringify({
			query: opts.query,
			k: opts.k,
			allowlist: opts.allowlist
		}),
		timeoutMs: getSemanticConfig().requestTimeoutMs
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`semantic worker search failed: ${res.status} ${body}`);
	}
	const data = (await res.json()) as { hits: SemanticSearchHit[] };
	return data.hits ?? [];
}

export async function semanticWorkerSimilar(opts: {
	query: string;
	vectorId: number;
	k: number;
	allowlist?: number[];
}): Promise<SemanticSearchHit[]> {
	const res = await workerFetch('/similar', {
		method: 'POST',
		body: JSON.stringify({
			query: opts.query,
			vector_id: opts.vectorId,
			k: opts.k,
			allowlist: opts.allowlist
		})
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`semantic worker similar failed: ${res.status} ${body}`);
	}
	const data = (await res.json()) as { hits: SemanticSearchHit[] };
	return data.hits ?? [];
}

export async function semanticWorkerIndexBatch(
	items: SemanticIndexItem[]
): Promise<{
	indexed: number;
	failed: Array<{ vectorId: number; error: string }>;
	timings?: { embedMs: number; upsertMs: number; itemCount: number };
}> {
	const res = await workerFetch('/indexBatch', {
		method: 'POST',
		body: JSON.stringify({ items }),
		timeoutMs: Math.max(getSemanticConfig().requestTimeoutMs, 60_000)
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`semantic worker indexBatch failed: ${res.status} ${body}`);
	}
	return (await res.json()) as {
		indexed: number;
		failed: Array<{ vectorId: number; error: string }>;
		timings?: { embedMs: number; upsertMs: number; itemCount: number };
	};
}

export async function semanticWorkerRemove(vectorIds: number[]): Promise<{ removed: number }> {
	const res = await workerFetch('/remove', {
		method: 'POST',
		body: JSON.stringify({ vector_ids: vectorIds })
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`semantic worker remove failed: ${res.status} ${body}`);
	}
	return (await res.json()) as { removed: number };
}

export async function semanticWorkerContains(
	vectorIds: number[]
): Promise<{ present: number[]; missing: number[] }> {
	if (vectorIds.length === 0) return { present: [], missing: [] };
	const res = await workerFetch('/contains', {
		method: 'POST',
		body: JSON.stringify({ vector_ids: vectorIds })
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`semantic worker contains failed: ${res.status} ${body}`);
	}
	return (await res.json()) as { present: number[]; missing: number[] };
}

export async function semanticWorkerSync(): Promise<{ ok: boolean; lastSyncAt: string }> {
	const res = await workerFetch('/sync', {
		method: 'POST',
		body: '{}',
		timeoutMs: 60_000
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`semantic worker sync failed: ${res.status} ${body}`);
	}
	return (await res.json()) as { ok: boolean; lastSyncAt: string };
}

export async function semanticWorkerRebuild(): Promise<{ ok: boolean }> {
	const res = await workerFetch('/rebuild', {
		method: 'POST',
		body: '{}',
		timeoutMs: 120_000
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`semantic worker rebuild failed: ${res.status} ${body}`);
	}
	return (await res.json()) as { ok: boolean };
}
