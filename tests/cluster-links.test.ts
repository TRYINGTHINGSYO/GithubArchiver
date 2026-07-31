import { describe, expect, it } from 'vitest';
import {
	clusterGrowthAnalysisHref,
	clusterReposHref,
	homepageClusterTitleHref
} from '$lib/cluster-links';

describe('homepage cluster navigation', () => {
	it('opens Portfolio Websites repositories through the cluster discovery route', () => {
		const renderedClusterHref = homepageClusterTitleHref({ slug: 'portfolio-websites' });
		expect(renderedClusterHref).toBe('/discover/fastest-growing?cluster=portfolio-websites');
	});

	it('keeps preliminary/activity cluster titles on the same cluster route', () => {
		const preliminary = { slug: 'portfolio-websites', isVerifiedGrowth: false };
		const href = homepageClusterTitleHref(preliminary);
		expect(href).toBe(clusterReposHref('portfolio-websites'));
		expect(href).toContain('/discover/fastest-growing');
		expect(href.endsWith('?cluster=portfolio-websites')).toBe(true);
	});

	it('uses the same destination for cluster titles and growth analysis', () => {
		expect(clusterGrowthAnalysisHref('portfolio-websites')).toBe(
			'/discover/fastest-growing?cluster=portfolio-websites'
		);
		expect(homepageClusterTitleHref({ slug: 'ai-agents' })).toBe(
			'/discover/fastest-growing?cluster=ai-agents'
		);
	});

	it('encodes cluster slugs safely', () => {
		expect(clusterReposHref('foo/bar')).toBe('/discover/fastest-growing?cluster=foo%2Fbar');
	});
});
