const CATEGORY_LABELS: Record<string, string> = {
	bot: 'Bot',
	library: 'Library',
	'cli-tool': 'CLI tool',
	'web-app': 'Web app',
	'mobile-app': 'Mobile app',
	game: 'Game',
	'data-ml': 'Data / ML',
	devops: 'DevOps',
	'docs-site': 'Docs site',
	template: 'Template',
	other: 'Other'
};

export function formatCategoryLabel(category: string | null | undefined): string | null {
	if (!category) return null;
	return CATEGORY_LABELS[category] ?? category.replaceAll('-', ' ');
}
