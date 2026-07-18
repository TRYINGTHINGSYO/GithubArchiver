/** Stable href helpers for cluster navigation (keep request-path and SSR in sync). */

export function clusterReposHref(slug: string): string {
	return `/?cluster=${encodeURIComponent(slug)}`;
}

export function clusterGrowthAnalysisHref(slug: string): string {
	return `/discover/fastest-growing?cluster=${encodeURIComponent(slug)}`;
}

/**
 * Homepage cluster titles always open the repositories in that cluster.
 * Growth analysis is a separate, optional secondary link for verified growth cards only.
 */
export function homepageClusterTitleHref(cluster: { slug: string }): string {
	return clusterReposHref(cluster.slug);
}
