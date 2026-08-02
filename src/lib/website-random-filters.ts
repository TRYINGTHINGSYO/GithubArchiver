export const WEBSITE_QUALITY_MIN = 0;
export const WEBSITE_QUALITY_MAX = 1;
export const WEBSITE_QUALITY_STEP = 0.1;

export function parseWebsiteQualityFilter(value: string | null): number | null {
	if (value == null || value.trim() === '') return null;

	const parsed = Number(value);
	if (
		!Number.isFinite(parsed) ||
		parsed < WEBSITE_QUALITY_MIN ||
		parsed > WEBSITE_QUALITY_MAX
	) {
		return null;
	}

	return parsed;
}
