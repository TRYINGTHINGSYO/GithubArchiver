export type DiscoveryPreset = {
	slug: string;
	title: string;
	description: string;
	filters: Record<string, unknown>;
	sort: string;
	minimumResults?: number;
};

export const DISCOVERY_PRESETS: DiscoveryPreset[] = [
	{
		slug: 'fastest-growing',
		title: 'Fastest-growing clusters',
		description: 'Clusters with meaningful week-over-week growth and enough current volume to avoid tiny-sample noise.',
		filters: {
			currentWeekCount: { min: 20 },
			previousWeekCount: { min: 5 }
		},
		sort: 'growth_desc',
		minimumResults: 3
	},
	{
		slug: 'projects-to-watch',
		title: 'Projects to Watch',
		description: 'High-signal repositories from clusters that are growing quickly.',
		filters: {
			signalTier: { not: 'low' },
			interestingScore: { min: 55 },
			clusterGrowthPercent: { min: 25 },
			currentWeekCount: { min: 20 },
			excludeCategories: ['school-assignment', 'spam-template']
		},
		sort: 'discovery_score_desc',
		minimumResults: 10
	},
	{
		slug: 'deleted-gems',
		title: 'Deleted but preserved',
		description: 'Deleted repositories that meet a minimum quality bar and still have recoverable archive evidence or useful metadata.',
		filters: {
			deletedOnly: true,
			interestingScore: { min: 55 }
		},
		sort: 'preservation_score_desc',
		minimumResults: 10
	}
];

export function getDiscoveryPreset(slug: string): DiscoveryPreset | null {
	return DISCOVERY_PRESETS.find((preset) => preset.slug === slug) ?? null;
}
