import {
	getClusterAnalytics,
	getClusterBySlug,
	getRepoClusterMemberships,
	listClusterAnalytics,
	listClusters,
	type ClusterAnalyticsRow,
	type ClusterMembershipWithSlug,
	type ClusterRow
} from '$lib/server/db/clusters';
import { queryRepos } from '$lib/server/db/repos';
import type { RepoQuery, RepoQueryResult } from '$lib/server/db/types';
import { listRepos } from '$lib/server/repos';

export type { ClusterAnalyticsRow, ClusterMembershipWithSlug, ClusterRow };

export function getAllClustersWithAnalytics(): ClusterAnalyticsRow[] {
	return listClusterAnalytics();
}

export function getClusterDetail(slug: string): ClusterAnalyticsRow | null {
	return getClusterAnalytics(slug);
}

export function getClusterRepos(slug: string, opts: RepoQuery = {}): RepoQueryResult | null {
	if (!getClusterBySlug(slug)) return null;
	return listRepos({
		...opts,
		clusters: [slug],
		clusterMatch: opts.clusterMatch ?? 'any'
	});
}

export function getRepoClusters(repoId: number): ClusterMembershipWithSlug[] {
	return getRepoClusterMemberships(repoId);
}

export function listClusterCatalog(): ClusterRow[] {
	return listClusters();
}
