const CATEGORY_LABELS: Record<string, string> = {
	product: 'Product',
	library: 'Library',
	framework: 'Framework',
	'awesome-list': 'Awesome list',
	'personal-website': 'Personal website',
	portfolio: 'Portfolio',
	'school-assignment': 'School assignment',
	'ai-project': 'AI project',
	game: 'Game',
	devops: 'DevOps',
	security: 'Security',
	'data-science': 'Data science',
	'mobile-app': 'Mobile app',
	'hardware-iot': 'Hardware / IoT',
	'spam-template': 'Spam / template',
	unknown: 'Unknown',
	// legacy display fallbacks
	bot: 'Bot',
	'cli-tool': 'CLI tool',
	'web-app': 'Web app',
	'data-ml': 'Data / ML',
	'docs-site': 'Docs site',
	template: 'Template',
	other: 'Other'
};

const LEGACY_CATEGORY_MAP: Record<string, string> = {
	bot: 'product',
	'cli-tool': 'library',
	'web-app': 'product',
	'data-ml': 'data-science',
	'docs-site': 'personal-website',
	template: 'spam-template',
	other: 'unknown'
};

const SIGNAL_TIER_LABELS: Record<string, string> = {
	low: 'Low signal',
	normal: 'Normal',
	high: 'High signal'
};

export function formatCategoryLabel(category: string | null | undefined): string | null {
	if (!category) return null;
	const normalized = LEGACY_CATEGORY_MAP[category] ?? category;
	return CATEGORY_LABELS[normalized] ?? CATEGORY_LABELS[category] ?? category.replaceAll('-', ' ');
}

export function formatSignalTierLabel(tier: string | null | undefined): string | null {
	if (!tier) return null;
	return SIGNAL_TIER_LABELS[tier] ?? tier.replaceAll('-', ' ');
}

export function isLegacyCategory(category: string | null | undefined): boolean {
	if (!category) return false;
	return category in LEGACY_CATEGORY_MAP;
}
