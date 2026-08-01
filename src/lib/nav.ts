export interface NavLink {
	href: string;
	label: string;
	hint?: string;
	accent?: 'repo' | 'web' | 'admin';
}

export interface NavSection {
	id: string;
	title: string;
	links: NavLink[];
}

/** Structured left-rail navigation — repositories and websites are peers. */
export const NAV_SECTIONS: NavSection[] = [
	{
		id: 'main',
		title: 'Main',
		links: [
			{ href: '/', label: 'Home' },
			{ href: '/discover', label: 'Discover', accent: 'repo' },
			{ href: '/discover/emerging', label: 'Emerging', accent: 'repo' },
			{ href: '/discover/fastest-growing', label: 'Trending', accent: 'repo' },
			{ href: '/birth-feed', label: 'New Today', accent: 'repo' },
			{ href: '/search?sort=interesting_score&max_stars=20', label: 'Hidden Gems', accent: 'repo' },
			{ href: '/discover/projects-to-watch', label: 'Exploding', accent: 'repo' },
			{ href: '/search', label: 'Repositories', accent: 'repo' },
			{ href: '/websites', label: 'Websites', accent: 'web' },
			{ href: '/favorites', label: 'Collections' },
			{ href: '/search', label: 'Search' }
		]
	},
	{
		id: 'repos',
		title: 'Repository Discovery',
		links: [
			{ href: '/search', label: 'All Repositories' },
			{ href: '/birth-feed', label: 'Recently Discovered' },
			{ href: '/search?never_enriched=0&sort=enriched', label: 'Recently Enriched' },
			{ href: '/discover/deleted-gems', label: 'Recently Archived' },
			{ href: '/discover/fastest-growing', label: 'Fastest Growing' },
			{ href: '/search?sort=interesting_score', label: 'Highest Quality' },
			{ href: '/search?q=AI&sort=interesting_score', label: 'AI Projects' },
			{ href: '/search?q=cli&sort=interesting_score', label: 'CLI' },
			{ href: '/search?q=security&sort=interesting_score', label: 'Security' },
			{ href: '/search?q=game&sort=interesting_score', label: 'Games' }
		]
	},
	{
		id: 'websites',
		title: 'Website Discovery',
		links: [
			{ href: '/websites', label: 'Website Discover', accent: 'web' },
			{ href: '/websites/random', label: 'Random Website', accent: 'web', hint: 'Primary random surface' },
			{ href: '/websites', label: 'New Websites', accent: 'web' },
			{ href: '/websites?sort=rated', label: 'Highest Rated', accent: 'web' },
			{ href: '/websites?sort=favorites', label: 'Most Favorited', accent: 'web' },
			{ href: '/websites', label: 'Recently Verified', accent: 'web' }
		]
	},
	{
		id: 'saved',
		title: 'Saved',
		links: [
			{ href: '/favorites', label: 'Favorite Repositories' },
			{ href: '/favorites?type=website', label: 'Favorite Websites', accent: 'web' },
			{ href: '/watch-later', label: 'Watch Later' },
			{ href: '/favorites', label: 'Collections' }
		]
	},
	{
		id: 'tools',
		title: 'Tools',
		links: [
			{ href: '/search', label: 'Topic Explorer' },
			{ href: '/discover', label: 'Similar Repositories' },
			{ href: '/websites', label: 'Website Explorer', accent: 'web' },
			{ href: '/admin/storage', label: 'Duplicate Management', accent: 'admin' }
		]
	},
	{
		id: 'admin',
		title: 'Admin',
		links: [
			{ href: '/admin', label: 'Dashboard', accent: 'admin' },
			{ href: '/admin/jobs', label: 'Job History', accent: 'admin' },
			{ href: '/admin/doctor', label: 'Health', accent: 'admin' },
			{ href: '/admin/storage', label: 'Storage', accent: 'admin' },
			{ href: '/admin/intelligence', label: 'Intelligence', accent: 'admin' }
		]
	}
];

export const RIGHT_RAIL_DEFAULT = {
	trendingRepos: true,
	trendingWebsites: true,
	topics: true,
	recent: true
};
