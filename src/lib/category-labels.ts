const CATEGORY_LABELS: Record<string, string> = {
	application: 'Application',
	product: 'Product',
	library: 'Library',
	framework: 'Framework',
	'developer-tool': 'Developer tool',
	dataset: 'Dataset',
	documentation: 'Documentation',
	template: 'Template',
	'personal-website': 'Personal website',
	'company-profile': 'Company profile',
	'portfolio-collection': 'Portfolio collection',
	portfolio: 'Portfolio',
	'school-assignment': 'School assignment',
	'research-project': 'Research project',
	'awesome-list': 'Awesome list',
	'ai-project': 'AI project',
	game: 'Game',
	bot: 'Bot',
	devops: 'DevOps',
	security: 'Security',
	'data-science': 'Data science',
	'mobile-app': 'Mobile app',
	'hardware-iot': 'Hardware / IoT',
	'spam-template': 'Spam / template',
	'generated-content': 'Generated content',
	unknown: 'Unknown',
	// legacy display fallbacks
	'cli-tool': 'CLI tool',
	'web-app': 'Web app',
	'data-ml': 'Data / ML',
	'docs-site': 'Docs site',
	other: 'Other'
};

const LEGACY_CATEGORY_MAP: Record<string, string> = {
	'cli-tool': 'library',
	'web-app': 'application',
	'data-ml': 'data-science',
	'docs-site': 'documentation',
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
