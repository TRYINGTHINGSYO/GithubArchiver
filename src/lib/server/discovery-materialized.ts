import { getDb } from './db/connection.js';
import {
	countClusterMemberships,
	listActiveClusterSummaries
} from './db/clusters.js';
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
import {
	completeDiscoveryMaterializationRun,
	type DiscoverySectionRowCounts,
	tryClaimDiscoveryMaterializationRun
} from './discovery-materialization.js';
import { CURRENT_EMERGING_DETECTION_VERSION, listEmergingTopics } from './emerging-topics.js';
import { clearTtlCache } from './ttl-cache.js';

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

type MaterializedRow = { rank: number; tier: DiscoveryTier; payload: unknown };

function insertMaterializedRows(
	table: string,
	rows: MaterializedRow[],
	materializedAt: string
): void {
	const db = getDb();
	db.prepare(`DELETE FROM ${table}`).run();
	for (const row of rows) {
		const columns = ['rank', 'tier', 'payload_json', 'materialized_at'];
		const values: unknown[] = [row.rank, row.tier, JSON.stringify(row.payload), materializedAt];
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
}

export interface MaterializeDiscoveryResult {
	status: 'success' | 'skipped_deduped' | 'failed';
	runId: number | null;
	qualified: number;
	preliminary: number;
	rowCounts: DiscoverySectionRowCounts;
	error?: string;
}

/**
 * Compute discovery sections, then publish all payload tables + status in one
 * transaction so a failed refresh never blanks last-known-good homepage data.
 * Concurrent callers across processes are deduped via a DB lease.
 */
export function materializeDiscoveryResults(
	opts: Partial<DiscoveryQuery> & { owner?: string; skipClaim?: boolean } = {}
): MaterializeDiscoveryResult {
	const emptyCounts: DiscoverySectionRowCounts = {
		projects_to_watch: 0,
		fastest_clusters: 0,
		deleted_preserved: 0,
		unusual_finds: 0,
		emerging_topics: 0
	};

	const claim = opts.skipClaim
		? ({ claimed: true, runId: -1, owner: opts.owner ?? 'direct' } as const)
		: tryClaimDiscoveryMaterializationRun({ owner: opts.owner });
	if (!claim.claimed) {
		return {
			status: 'skipped_deduped',
			runId: claim.activeRunId,
			qualified: 0,
			preliminary: 0,
			rowCounts: emptyCounts
		};
	}

	const runId = claim.runId;
	try {
		const query = parseDiscoveryQuery(new URL(`http://local/?limit=${opts.limit ?? 50}`));
		if (opts.period) query.period = opts.period;
		if (opts.minScore != null) query.minScore = opts.minScore;
		if (opts.limit != null) query.limit = opts.limit;

		const qualifiedProjects = getProjectsToWatch(query);
		const preliminaryProjects =
			qualifiedProjects.length > 0 ? [] : getPreliminaryProjectsToWatch(query);
		const qualifiedClusters = getFastestGrowingClusters(query);
		const preliminaryClusters =
			qualifiedClusters.length > 0 ? [] : getPreliminaryGrowingClusters({ ...query, limit: 24 });
		const deletedGems = getDeletedGems(query);
		const unusualFinds = getUnusualFinds(query);
		const preliminaryUnusual =
			unusualFinds.length > 0
				? []
				: getUnusualFinds({ ...query, minScore: 35, limit: query.limit });
		const emerging = listEmergingTopics({ limit: query.limit });

		const projectsRows: MaterializedRow[] = [
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
		];
		const clusterRows: MaterializedRow[] = [
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
		];
		const deletedRows: MaterializedRow[] = deletedGems.map((item, index) => ({
			rank: index + 1,
			tier: 'qualified' as const,
			payload: item
		}));
		const unusualRows: MaterializedRow[] = [
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
		];
		const emergingRows: MaterializedRow[] = emerging.map((item, index) => ({
			rank: index + 1,
			tier: 'qualified' as const,
			payload: item
		}));

		const rowCounts: DiscoverySectionRowCounts = {
			projects_to_watch: projectsRows.length,
			fastest_clusters: clusterRows.length,
			deleted_preserved: deletedRows.length,
			unusual_finds: unusualRows.length,
			emerging_topics: emergingRows.length
		};

		const db = getDb();
		const publishedAt = new Date().toISOString();
		db.transaction(() => {
			insertMaterializedRows('discovery_projects_to_watch', projectsRows, publishedAt);
			insertMaterializedRows('discovery_fastest_clusters', clusterRows, publishedAt);
			insertMaterializedRows('discovery_deleted_preserved', deletedRows, publishedAt);
			insertMaterializedRows('discovery_unusual_finds', unusualRows, publishedAt);
			insertMaterializedRows('discovery_emerging_topics', emergingRows, publishedAt);
			updateDiscoverySystemStatus('idle');
			markDiscoveryAnalysisComplete(publishedAt);
		})();

		completeDiscoveryMaterializationRun(runId, {
			status: 'success',
			rowCounts,
			published: true
		});
		// Live analytics TTL must not outrank a freshly published empty snapshot.
		clearTtlCache();

		return {
			status: 'success',
			runId: runId < 0 ? null : runId,
			qualified:
				qualifiedProjects.length +
				qualifiedClusters.length +
				deletedGems.length +
				unusualFinds.length +
				emerging.length,
			preliminary:
				preliminaryProjects.length + preliminaryClusters.length + preliminaryUnusual.length,
			rowCounts
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		completeDiscoveryMaterializationRun(runId, {
			status: 'failed',
			error: message,
			published: false
		});
		return {
			status: 'failed',
			runId: runId < 0 ? null : runId,
			qualified: 0,
			preliminary: 0,
			rowCounts: emptyCounts,
			error: message
		};
	}
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
	const repoCount = countRepos();
	const membershipCount = countClusterMemberships();
	// After a volume wipe (or partial wipe), materialization tables can outlive live
	// memberships. Never surface cluster cards without live membership rows — seeded
	// registry definitions alone are not intelligence.
	const hasLiveClusters = membershipCount > 0;
	if (!hasLiveClusters) {
		purgeStaleClusterMaterialization();
	}

	const emergingTopics =
		repoCount === 0
			? []
			: readMaterializedPayloads<{ detection_version?: number }>('discovery_emerging_topics').filter(
					(topic) => topic.detection_version === CURRENT_EMERGING_DETECTION_VERSION
				);

	return {
		presets: DISCOVERY_PRESETS,
		fastestGrowing: hasLiveClusters
			? readMaterializedPayloads<DiscoveryClusterCard>('discovery_fastest_clusters').slice(0, limit)
			: [],
		projectsToWatch: hasLiveClusters
			? readMaterializedPayloads<ProjectsToWatchItem>('discovery_projects_to_watch').slice(0, limit)
			: [],
		deletedGems:
			repoCount === 0
				? []
				: readMaterializedPayloads<DeletedGemItem>('discovery_deleted_preserved').slice(0, limit),
		unusualFinds:
			repoCount === 0
				? []
				: readMaterializedPayloads<DiscoveryRepoCard>('discovery_unusual_finds').slice(0, limit),
		emergingTopics: emergingTopics.slice(0, limit),
		// Use maintained repo_count — avoid N+1 analytics on every page load.
		clusters: hasLiveClusters ? listActiveClusterSummaries(24) : []
	};
}

/** Drop orphaned cluster payloads when the live membership graph is empty. */
function purgeStaleClusterMaterialization(): void {
	const db = getDb();
	const tables = ['discovery_fastest_clusters', 'discovery_projects_to_watch'] as const;
	for (const table of tables) {
		const exists = db
			.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
			.get(table) as { ok: number } | undefined;
		if (!exists) continue;
		db.prepare(`DELETE FROM ${table}`).run();
	}
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

export function markDiscoveryAnalysisComplete(at = new Date().toISOString()): void {
	const db = getDb();
	db.prepare(
		`UPDATE discovery_system_status SET last_discovery_analysis_at = ?, updated_at = ? WHERE id = 1`
	).run(at, at);
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

	// Read-only on the request path. Daemon/materializer calls updateDiscoverySystemStatus().
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
