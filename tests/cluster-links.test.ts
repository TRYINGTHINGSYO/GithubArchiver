import { describe, expect, it } from 'vitest';
import {
	clusterGrowthAnalysisHref,
	clusterReposHref,
	homepageClusterTitleHref
} from '$lib/cluster-links';

describe('homepage cluster navigation', () => {
	it('opens Portfolio Websites repositories via /?cluster=', () => {
		const renderedClusterHref = homepageClusterTitleHref({ slug: 'portfolio-websites' });
		expect(renderedClusterHref).toBe('/?cluster=portfolio-websites');
	});

	it('never sends preliminary/activity cluster titles to fastest-growing', () => {
		const preliminary = { slug: 'portfolio-websites', isVerifiedGrowth: false };
		const href = homepageClusterTitleHref(preliminary);
		expect(href).toBe(clusterReposHref('portfolio-websites'));
		expect(href).not.toContain('/discover/fastest-growing');
		expect(href.startsWith('/?cluster=')).toBe(true);
	});

	it('keeps growth analysis on a separate optional link', () => {
		expect(clusterGrowthAnalysisHref('portfolio-websites')).toBe(
			'/discover/fastest-growing?cluster=portfolio-websites'
		);
		// Title href stays on repo browse even when growth analysis exists.
		expect(homepageClusterTitleHref({ slug: 'ai-agents' })).toBe('/?cluster=ai-agents');
	});

	it('encodes cluster slugs safely', () => {
		expect(clusterReposHref('foo/bar')).toBe('/?cluster=foo%2Fbar');
	});
});
