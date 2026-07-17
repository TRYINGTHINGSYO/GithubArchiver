import { getDb } from './connection.js';
import { CLUSTER_DEFINITIONS, CURRENT_CLUSTER_VERSION } from '$lib/server/cluster-registry';
import type { ClusterMatchEvidence } from '$lib/server/cluster-repo';
import type { RepoRow } from './types.js';

export { CURRENT_CLUSTER_VERSION };

export interface ClusterRow {
	id: number;
	slug: string;
	name: string;
	description: string | null;
	cluster_type: string;
	repo_count: number;
	created_at: string;
	updated_at: string;
}

export interface ClusterMembershipRow {
	repository_id: number;
	cluster_id: number;
	confidence: number;
	evidence_json: string;
	clustered_at: string;
}

export interface ClusterMembershipWithSlug extends ClusterMembershipRow {
	slug: string;
	name: string;
}

export function ensureClusterRegistry(): void {
	const db = getDb();
	const now = new Date().toISOString();
	const stmt = db.prepare(
		`INSERT INTO repo_clusters (slug, name, description, cluster_type, repo_count, created_at, updated_at)
		 VALUES (?, ?, ?, 'curated', 0, ?, ?)
		 ON CONFLICT(slug) DO UPDATE SET
		   name = excluded.name,
		   description = excluded.description,
		   updated_at = excluded.updated_at`
	);
	for (const def of CLUSTER_DEFINITIONS) {
		stmt.run(def.slug, def.name, def.description ?? null, now, now);
	}
}

export function getClusterBySlug(slug: string): ClusterRow | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM repo_clusters WHERE slug = ?').get(slug) as
		| ClusterRow
		| undefined;
	return row ?? null;
}

export function listClusters(): ClusterRow[] {
	const db = getDb();
	return db.prepare('SELECT * FROM repo_clusters ORDER BY name').all() as ClusterRow[];
}

export function saveRepoClusterMemberships(
	repoId: number,
	memberships: { slug: string; confidence: number; evidence: ClusterMatchEvidence }[]
): void {
	const db = getDb();
	const now = new Date().toISOString();

	const previousSlugs = listClusterSlugsForRepo(repoId);

	const tx = db.transaction(() => {
		db.prepare('DELETE FROM repository_cluster_memberships WHERE repository_id = ?').run(repoId);

		const findCluster = db.prepare('SELECT id FROM repo_clusters WHERE slug = ?');
		const insert = db.prepare(
			`INSERT INTO repository_cluster_memberships
			 (repository_id, cluster_id, confidence, evidence_json, clustered_at)
			 VALUES (?, ?, ?, ?, ?)`
		);

		for (const membership of memberships) {
			const cluster = findCluster.get(membership.slug) as { id: number } | undefined;
			if (!cluster) continue;
			insert.run(
				repoId,
				cluster.id,
				membership.confidence,
				JSON.stringify(membership.evidence),
				now
			);
		}
	});

	tx();
	const affectedSlugs = [...new Set([...previousSlugs, ...memberships.map((m) => m.slug)])];
	refreshClusterRepoCounts(affectedSlugs);
}

function listClusterSlugsForRepo(repoId: number): string[] {
	const db = getDb();
	return (
		db
			.prepare(
				`SELECT c.slug FROM repository_cluster_memberships m
				 JOIN repo_clusters c ON c.id = m.cluster_id
				 WHERE m.repository_id = ?`
			)
			.all(repoId) as { slug: string }[]
	).map((row) => row.slug);
}

export function refreshClusterRepoCounts(slugs?: string[]): void {
	const db = getDb();
	const now = new Date().toISOString();

	if (slugs?.length) {
		const stmt = db.prepare(
			`UPDATE repo_clusters SET
			   repo_count = (
			     SELECT COUNT(*) FROM repository_cluster_memberships m
			     WHERE m.cluster_id = repo_clusters.id
			   ),
			   updated_at = ?
			 WHERE slug = ?`
		);
		for (const slug of slugs) stmt.run(now, slug);
		return;
	}

	db.prepare(
		`UPDATE repo_clusters SET
		   repo_count = (
		     SELECT COUNT(*) FROM repository_cluster_memberships m
		     WHERE m.cluster_id = repo_clusters.id
		   ),
		   updated_at = ?`
	).run(now);
}

export function setRepoClusterVersion(repoId: number, version: number): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare('UPDATE repos SET cluster_version = ?, clustered_at = ? WHERE id = ?').run(
		version,
		now,
		repoId
	);
}

export function listReposForClustering(
	limit: number,
	afterId: number,
	targetVersion: number,
	force: boolean
): RepoRow[] {
	const db = getDb();
	if (force) {
		return db
			.prepare(
				`SELECT * FROM repos
				 WHERE enriched_at IS NOT NULL AND id > ?
				 ORDER BY id ASC
				 LIMIT ?`
			)
			.all(afterId, limit) as RepoRow[];
	}

	return db
		.prepare(
			`SELECT * FROM repos
			 WHERE enriched_at IS NOT NULL
			   AND id > ?
			   AND (cluster_version IS NULL OR cluster_version < ?)
			 ORDER BY id ASC
			 LIMIT ?`
		)
		.all(afterId, targetVersion, limit) as RepoRow[];
}

export function getRepoClusterMemberships(repoId: number): ClusterMembershipWithSlug[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT m.*, c.slug, c.name
			 FROM repository_cluster_memberships m
			 JOIN repo_clusters c ON c.id = m.cluster_id
			 WHERE m.repository_id = ?
			 ORDER BY m.confidence DESC`
		)
		.all(repoId) as ClusterMembershipWithSlug[];
}

export interface ClusterAnalyticsRow {
	slug: string;
	name: string;
	description: string | null;
	cluster_type: string;
	repo_count: number;
	new_24h: number;
	new_7d: number;
	new_prev_7d: number;
	avg_interesting_score: number | null;
	deleted_count: number;
	archived_count: number;
	top_languages: { language: string; count: number }[];
	growth_pct: number | null;
}

export function getClusterAnalytics(slug: string): ClusterAnalyticsRow | null {
	const cluster = getClusterBySlug(slug);
	if (!cluster) return null;

	const db = getDb();
	const now = Date.now();
	const day = 86_400_000;
	const since24h = new Date(now - day).toISOString();
	const since7d = new Date(now - 7 * day).toISOString();
	const since14d = new Date(now - 14 * day).toISOString();

	const counts = db
		.prepare(
			`SELECT
			   COUNT(*) as repo_count,
			   SUM(CASE WHEN r.first_seen_at >= ? THEN 1 ELSE 0 END) as new_24h,
			   SUM(CASE WHEN r.first_seen_at >= ? THEN 1 ELSE 0 END) as new_7d,
			   SUM(CASE WHEN r.first_seen_at >= ? AND r.first_seen_at < ? THEN 1 ELSE 0 END) as new_prev_7d,
			   AVG(r.interesting_score) as avg_interesting_score,
			   SUM(CASE WHEN r.deleted_at IS NOT NULL THEN 1 ELSE 0 END) as deleted_count,
			   SUM(CASE WHEN r.github_archived = 1 THEN 1 ELSE 0 END) as archived_count
			 FROM repository_cluster_memberships m
			 JOIN repos r ON r.id = m.repository_id
			 WHERE m.cluster_id = ?`
		)
		.get(since24h, since7d, since14d, since7d, cluster.id) as {
		repo_count: number;
		new_24h: number;
		new_7d: number;
		new_prev_7d: number;
		avg_interesting_score: number | null;
		deleted_count: number;
		archived_count: number;
	};

	const topLanguages = db
		.prepare(
			`SELECT r.language, COUNT(*) as count
			 FROM repository_cluster_memberships m
			 JOIN repos r ON r.id = m.repository_id
			 WHERE m.cluster_id = ? AND r.language IS NOT NULL AND r.language != ''
			 GROUP BY r.language
			 ORDER BY count DESC
			 LIMIT 5`
		)
		.all(cluster.id) as { language: string; count: number }[];

	const growthPct =
		counts.new_prev_7d > 0
			? Math.round(((counts.new_7d - counts.new_prev_7d) / counts.new_prev_7d) * 1000) / 10
			: counts.new_7d > 0
				? 100
				: null;

	return {
		slug: cluster.slug,
		name: cluster.name,
		description: cluster.description,
		cluster_type: cluster.cluster_type,
		repo_count: counts.repo_count,
		new_24h: counts.new_24h,
		new_7d: counts.new_7d,
		new_prev_7d: counts.new_prev_7d,
		avg_interesting_score:
			counts.avg_interesting_score != null
				? Math.round(counts.avg_interesting_score * 10) / 10
				: null,
		deleted_count: counts.deleted_count,
		archived_count: counts.archived_count,
		top_languages: topLanguages,
		growth_pct: growthPct
	};
}

export function listClusterAnalytics(): ClusterAnalyticsRow[] {
	ensureClusterRegistry();
	return listClusters()
		.map((cluster) => getClusterAnalytics(cluster.slug))
		.filter((row): row is ClusterAnalyticsRow => row != null)
		.sort((a, b) => b.repo_count - a.repo_count);
}

export function getClusterIdBySlug(slug: string): number | null {
	return getClusterBySlug(slug)?.id ?? null;
}
