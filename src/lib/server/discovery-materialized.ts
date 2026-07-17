import { getDb } from './db/connection.js';
import { listClusterAnalytics } from './db/clusters.js';
import { countRepos, countUnenriched } from './db/repos.js';
import { getLatestJobsByType } from './db/jobs.js';
import type {
	DeletedGemItem,
	DiscoveryClusterCard,
	DiscoveryLanding,
	DiscoveryQuery,
	DiscoveryRepoCard,
	ProjectsToWatchItem
} from './discovery.js';
import {
	getDeletedGems,
	getFastestGrowingClusters,
	getPreliminaryGrowingClusters,
	getPreliminaryProjectsToWatch,
	getProjectsToWatch,
	getUnusualFinds,
	parseDiscoveryQuery
} from './discovery.js';
import { DISCOVERY_PRESETS } from './discovery-presets.js';
import { listEmergingTopics } from './emerging-topics.js';

export type DiscoveryTier = 'qualified' | 'preliminary';

export interface DiscoverySystemStatus {
	repositoriesDiscovered: number;
	enriched: number;
	classified: number;
	clustered: number;
	lastIngestionAt: string | null;
	lastDiscoveryAnalysisAt: string | null;
	lastEmergingAnalysisAt: string | null;
	workerStatus: 'running' | 'idle' | 'unknown';
	updatedAt: string;
}

function replaceTable(
	table: string,
	rows: { rank: number; tier: DiscoveryTier; payload: unknown }[]
): void {
	const db = getDb();
	const now = new Date().toISOString();
	const tx = db.transaction(() => {
		db.prepare(`DELETE FROM ${table}`).run();
		for (const row of rows) {
			const columns = ['rank', 'tier', 'payload_json', 'materialized_at'];
			const values: unknown[] = [row.rank, row.tier, JSON.stringify(row.payload), now];
			if (table === 'discovery_projects_to_watch') {
				columns.splice(2, 0, 'repo_id', 'discovery_score');
				const item = row.payload as ProjectsToWatchItem;
				values.splice(2, 0, item.id, item.discoveryScore);
			} else if (table === 'discovery_deleted_preserved') {
				columns.splice(2, 0, 'repo_id', 'preservation_score');
				const item = row.payload as DeletedGemItem;
				values.splice(2, 0, item.id, item.preservationScore);
			} else if (table === 'discovery_unusual_finds') {
				columns.splice(2, 0, 'repo_id');
				values.splice(2, 0, (row.payload as DiscoveryRepoCard).id);
			} else if (table === 'discovery_fastest_clusters') {
				columns.splice(2, 0, 'cluster_slug');
				values.splice(2, 0, (row.payload as DiscoveryClusterCard).slug);
			} else if (table === 'discovery_emerging_topics') {
				columns.splice(2, 0, 'topic_key');
				values.splice(2, 0, (row.payload as { key: string }).key);
			}
			db.prepare(
				`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
			).run(...values);
		}
	});
	tx();
}

export function materializeDiscoveryResults(opts: Partial<DiscoveryQuery> = {}): {
	qualified: number;
	preliminary: number;
} {
	const query = parseDiscoveryQuery(new URL(`http://local/?limit=${opts.limit ?? 50}`));
	if (opts.period) query.period = opts.period;
	if (opts.minScore != null) query.minScore = opts.minScore;
	if (opts.limit != null) query.limit = opts.limit;

	const qualifiedProjects = getProjectsToWatch(query);
	const preliminaryProjects = qualifiedProjects.length > 0 ? [] : getPreliminaryProjectsToWatch(query);
	const qualifiedClusters = getFastestGrowingClusters(query);
	const preliminaryClusters =
		qualifiedClusters.length > 0 ? [] : getPreliminaryGrowingClusters({ ...query, limit: 24 });
	const deletedGems = getDeletedGems(query);
	const unusualFinds = getUnusualFinds(query);
	const preliminaryUnusual =
		unusualFinds.length > 0 ? [] : getUnusualFinds({ ...query, minScore: 35, limit: query.limit });
	const emerging = listEmergingTopics({ limit: query.limit });

	replaceTable('discovery_projects_to_watch', [
		...qualifiedProjects.map((item, index) => ({
			rank: index + 1,
			tier: 'qualified' as const,
			payload: item
		})),
		...preliminaryProjects.map((item, index) => ({
			rank: index + 1,
			tier: 'preliminary' as const,
			payload: item
		}))
	]);

	replaceTable('discovery_fastest_clusters', [
		...qualifiedClusters.map((item, index) => ({
			rank: index + 1,
			tier: 'qualified' as const,
			payload: item
		})),
		...preliminaryClusters.map((item, index) => ({
			rank: index + 1,
			tier: 'preliminary' as const,
			payload: item
		}))
	]);

	replaceTable(
		'discovery_deleted_preserved',
		deletedGems.map((item, index) => ({
			rank: index + 1,
			tier: 'qualified' as const,
			payload: item
		}))
	);

	replaceTable('discovery_unusual_finds', [
		...unusualFinds.map((item, index) => ({
			rank: index + 1,
			tier: 'qualified' as const,
			payload: item
		})),
		...preliminaryUnusual.map((item, index) => ({
			rank: index + 1,
			tier: 'preliminary' as const,
			payload: item
		}))
	]);

	replaceTable(
		'discovery_emerging_topics',
		emerging.map((item, index) => ({
			rank: index + 1,
			tier: 'qualified' as const,
			payload: item
		}))
	);

	updateDiscoverySystemStatus('running');
	markDiscoveryAnalysisComplete();
	return {
		qualified:
			qualifiedProjects.length +
			qualifiedClusters.length +
			deletedGems.length +
			unusualFinds.length +
			emerging.length,
		preliminary: preliminaryProjects.length + preliminaryClusters.length + preliminaryUnusual.length
	};
}

function readMaterializedPayloads<T>(table: string): T[] {
	const db = getDb();
	const rows = db
		.prepare(`SELECT payload_json FROM ${table} ORDER BY tier DESC, rank ASC`)
		.all() as { payload_json: string }[];
	return rows.map((row) => JSON.parse(row.payload_json) as T);
}

export function getMaterializedDiscoveryLanding(
	opts: Partial<DiscoveryQuery> = {}
): DiscoveryLanding | null {
	const db = getDb();
	const tables = new Set(
		(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
			(row) => row.name
		)
	);
	if (!tables.has('discovery_system_status')) return null;

	const status = db
		.prepare('SELECT last_discovery_analysis_at FROM discovery_system_status WHERE id = 1')
		.get() as { last_discovery_analysis_at: string | null } | undefined;
	if (!status?.last_discovery_analysis_at) return null;

	const limit = opts.limit ?? 50;
	return {
		presets: DISCOVERY_PRESETS,
		fastestGrowing: readMaterializedPayloads<DiscoveryClusterCard>('discovery_fastest_clusters').slice(
			0,
			limit
		),
		projectsToWatch: readMaterializedPayloads<ProjectsToWatchItem>(
			'discovery_projects_to_watch'
		).slice(0, limit),
		deletedGems: readMaterializedPayloads<DeletedGemItem>('discovery_deleted_preserved').slice(
			0,
			limit
		),
		unusualFinds: readMaterializedPayloads<DiscoveryRepoCard>('discovery_unusual_finds').slice(
			0,
			limit
		),
		emergingTopics: readMaterializedPayloads('discovery_emerging_topics').slice(0, limit),
		clusters: listClusterAnalytics().filter((cluster) => cluster.repo_count > 0).slice(0, 24)
	};
}

export function updateDiscoverySystemStatus(
	workerStatus: DiscoverySystemStatus['workerStatus'] = 'running'
): void {
	const db = getDb();
	const totalRepos = countRepos();
	const enriched = totalRepos - countUnenriched();
	const classified = (
		db.prepare(
			`SELECT COUNT(*) AS c FROM repos WHERE classified_at IS NOT NULL AND deleted_at IS NULL`
		).get() as { c: number }
	).c;
	const clustered = (
		db.prepare(`SELECT COUNT(*) AS c FROM repos WHERE clustered_at IS NOT NULL`).get() as { c: number }
	).c;
	const ingestJob = getLatestJobsByType().ingest;
	const existing = db
		.prepare(
			'SELECT last_discovery_analysis_at, last_emerging_analysis_at FROM discovery_system_status WHERE id = 1'
		)
		.get() as
		| { last_discovery_analysis_at: string | null; last_emerging_analysis_at: string | null }
		| undefined;

	db.prepare(
		`INSERT INTO discovery_system_status (
		   id, repositories_discovered, enriched, classified, clustered,
		   last_ingestion_at, last_discovery_analysis_at, last_emerging_analysis_at,
		   worker_status, updated_at
		 ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   repositories_discovered = excluded.repositories_discovered,
		   enriched = excluded.enriched,
		   classified = excluded.classified,
		   clustered = excluded.clustered,
		   last_ingestion_at = COALESCE(excluded.last_ingestion_at, discovery_system_status.last_ingestion_at),
		   last_discovery_analysis_at = COALESCE(excluded.last_discovery_analysis_at, discovery_system_status.last_discovery_analysis_at),
		   last_emerging_analysis_at = COALESCE(excluded.last_emerging_analysis_at, discovery_system_status.last_emerging_analysis_at),
		   worker_status = excluded.worker_status,
		   updated_at = excluded.updated_at`
	).run(
		totalRepos,
		enriched,
		classified,
		clustered,
		ingestJob?.finished_at ?? ingestJob?.started_at ?? null,
		existing?.last_discovery_analysis_at ?? null,
		existing?.last_emerging_analysis_at ?? null,
		workerStatus,
		new Date().toISOString()
	);
}

export function markDiscoveryAnalysisComplete(): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE discovery_system_status SET last_discovery_analysis_at = ?, updated_at = ? WHERE id = 1`
	).run(now, now);
}

export function markEmergingAnalysisComplete(): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE discovery_system_status SET last_emerging_analysis_at = ?, updated_at = ? WHERE id = 1`
	).run(now, now);
}

export function getDiscoverySystemStatus(): DiscoverySystemStatus {
	const db = getDb();
	const tables = new Set(
		(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
			(row) => row.name
		)
	);
	if (!tables.has('discovery_system_status')) {
		return {
			repositoriesDiscovered: countRepos(),
			enriched: countRepos() - countUnenriched(),
			classified: 0,
			clustered: 0,
			lastIngestionAt: null,
			lastDiscoveryAnalysisAt: null,
			lastEmergingAnalysisAt: null,
			workerStatus: 'unknown',
			updatedAt: new Date().toISOString()
		};
	}

	updateDiscoverySystemStatus();
	const row = db.prepare('SELECT * FROM discovery_system_status WHERE id = 1').get() as
		| {
				repositories_discovered: number;
				enriched: number;
				classified: number;
				clustered: number;
				last_ingestion_at: string | null;
				last_discovery_analysis_at: string | null;
				last_emerging_analysis_at: string | null;
				worker_status: string;
				updated_at: string;
		  }
		| undefined;

	return {
		repositoriesDiscovered: row?.repositories_discovered ?? 0,
		enriched: row?.enriched ?? 0,
		classified: row?.classified ?? 0,
		clustered: row?.clustered ?? 0,
		lastIngestionAt: row?.last_ingestion_at ?? null,
		lastDiscoveryAnalysisAt: row?.last_discovery_analysis_at ?? null,
		lastEmergingAnalysisAt: row?.last_emerging_analysis_at ?? null,
		workerStatus: (row?.worker_status as DiscoverySystemStatus['workerStatus']) ?? 'unknown',
		updatedAt: row?.updated_at ?? new Date().toISOString()
	};
}

export function formatRelativeTime(iso: string | null): string | null {
	if (!iso) return null;
	const ms = Date.now() - Date.parse(iso);
	if (!Number.isFinite(ms) || ms < 0) return null;
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.round(hours / 24);
	return `${days} day${days === 1 ? '' : 's'} ago`;
}
