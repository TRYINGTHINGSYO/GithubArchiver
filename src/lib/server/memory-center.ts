/**
 * Helpers for the Memory Center product surface (read-only over the knowledge corpus).
 */
import {
	ENTRY_TYPES,
	type EntryType,
	type MemoryEntry,
	buildAliasIndex,
	loadMemoryEntries,
	queryMemoryDetailed,
	resolveRef,
	type QueryResult
} from '$lib/server/ai-memory';

export interface MemoryStats {
	entries: number;
	decisions: number;
	incidents: number;
	migrations: number;
	features: number;
	edges: number;
	nodes: number;
	byType: Record<string, number>;
	online: true;
}

export interface MemoryGraphNode {
	id: string;
	title: string;
	type: EntryType;
	date: string;
	status: string;
	confidence: string;
}

export interface MemoryGraphEdge {
	from: string;
	to: string;
	type: string;
}

export interface MemoryGraph {
	nodes: MemoryGraphNode[];
	edges: MemoryGraphEdge[];
}

export interface InvestigationStep {
	id: string;
	title: string;
	type: EntryType;
	date: string;
	summary: string;
	status: string;
	confidence: string;
	via: string | null;
}

export function getMemoryCorpus(): MemoryEntry[] {
	return loadMemoryEntries();
}

export function computeMemoryStats(entries: MemoryEntry[]): MemoryStats {
	const byType: Record<string, number> = {};
	for (const t of ENTRY_TYPES) byType[t] = 0;
	let edges = 0;
	for (const e of entries) {
		byType[e.type] = (byType[e.type] ?? 0) + 1;
		edges += e.relationships.length;
	}
	return {
		entries: entries.length,
		decisions: byType.decision ?? 0,
		incidents: byType.incident ?? 0,
		migrations: byType.migration ?? 0,
		features: byType.feature ?? 0,
		edges,
		nodes: entries.length,
		byType,
		online: true
	};
}

export function buildMemoryGraph(entries: MemoryEntry[]): MemoryGraph {
	const aliases = buildAliasIndex(entries);
	const nodes: MemoryGraphNode[] = entries.map((e) => ({
		id: e.id,
		title: e.title,
		type: e.type,
		date: e.date,
		status: e.status,
		confidence: e.confidence
	}));
	const edges: MemoryGraphEdge[] = [];
	const seen = new Set<string>();
	for (const e of entries) {
		for (const r of e.relationships) {
			const target = resolveRef(r.id, aliases);
			if (!target) continue;
			const key = `${e.id}->${r.type}->${target.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			edges.push({ from: e.id, to: target.id, type: r.type });
		}
	}
	return { nodes, edges };
}

/** Chronological investigation path around a seed entry (related component). */
export function buildInvestigation(seedId: string, entries: MemoryEntry[]): InvestigationStep[] {
	const aliases = buildAliasIndex(entries);
	const seed = resolveRef(seedId, aliases);
	if (!seed) return [];

	const visited = new Set<string>([seed.id]);
	const queue: Array<{ id: string; via: string | null }> = [{ id: seed.id, via: null }];
	const steps: InvestigationStep[] = [];

	while (queue.length) {
		const cur = queue.shift()!;
		const entry = resolveRef(cur.id, aliases);
		if (!entry) continue;
		steps.push({
			id: entry.id,
			title: entry.title,
			type: entry.type,
			date: entry.date,
			summary: entry.summary,
			status: entry.status,
			confidence: entry.confidence,
			via: cur.via
		});
		for (const r of entry.relationships) {
			const next = resolveRef(r.id, aliases);
			if (!next || visited.has(next.id)) continue;
			visited.add(next.id);
			queue.push({ id: next.id, via: `${r.type} →` });
		}
		// Also pull inbound edges so the component is complete
		for (const other of entries) {
			if (visited.has(other.id)) continue;
			const hit = other.relationships.find((r) => resolveRef(r.id, aliases)?.id === entry.id);
			if (!hit) continue;
			visited.add(other.id);
			queue.push({ id: other.id, via: `← ${hit.type}` });
		}
	}

	return steps.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function runMemoryQuery(query: string, budget = 6000): QueryResult {
	return queryMemoryDetailed(getMemoryCorpus(), query, { budget, limit: 8 });
}

export function serializeEntry(e: MemoryEntry) {
	return {
		id: e.id,
		date: e.date,
		pr: e.pr,
		commit: e.commit,
		area: e.area,
		type: e.type,
		status: e.status,
		confidence: e.confidence,
		durability: e.durability,
		title: e.title,
		migration: e.migration,
		summary: e.summary,
		body: e.body,
		relationships: e.relationships,
		related: e.related
	};
}

export type SerializedEntry = ReturnType<typeof serializeEntry>;
