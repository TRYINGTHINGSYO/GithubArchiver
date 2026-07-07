import type { RepoCategory } from '$lib/server/classify-repo';
import { getLatestCategoryDaily } from '$lib/server/db/category-stats';

const CATEGORY_SEARCH_QUALIFIERS: Partial<Record<RepoCategory, string>> = {
	'cli-tool': 'topic:cli',
	game: 'topic:game',
	'data-ml': 'topic:machine-learning',
	devops: 'topic:devops',
	'web-app': 'topic:frontend',
	'library': 'topic:library'
};

export function categorySearchQualifier(category: string): string | null {
	return CATEGORY_SEARCH_QUALIFIERS[category as RepoCategory] ?? null;
}

export function getUnderrepresentedCategories(thresholdPct = 1.0): string[] {
	const daily = getLatestCategoryDaily();
	if (daily.length === 0) return [];
	return daily.filter((row) => row.pct_of_total < thresholdPct).map((row) => row.category);
}

export function pickGapCategoryForHour(hourKey: string, gaps: string[]): string | null {
	if (gaps.length === 0) return null;
	const index = Math.abs(hashHourKey(hourKey)) % gaps.length;
	return gaps[index] ?? null;
}

function hashHourKey(hourKey: string): number {
	let hash = 0;
	for (const ch of hourKey) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
	return hash;
}
