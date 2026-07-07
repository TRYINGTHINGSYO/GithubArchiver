export const REPO_CATEGORIES = [
	'bot',
	'library',
	'cli-tool',
	'web-app',
	'mobile-app',
	'game',
	'data-ml',
	'devops',
	'docs-site',
	'template',
	'other'
] as const;

export type RepoCategory = (typeof REPO_CATEGORIES)[number];

export interface ClassifyRepoInput {
	owner: string;
	name: string;
	full_name: string;
	description: string | null;
	language: string | null;
	topics: string[];
	stars: number | null;
	forks: number | null;
	readmeExcerpt?: string | null;
	filePaths?: string[];
}

export interface ClassifyRepoResult {
	category: RepoCategory;
	confidence: number;
}

export function classifyRepo(input: ClassifyRepoInput): ClassifyRepoResult {
	const name = input.name.toLowerCase();
	const topics = input.topics.map((t) => t.toLowerCase());
	const paths = (input.filePaths ?? []).map((p) => p.toLowerCase());
	const readme = (input.readmeExcerpt ?? '').toLowerCase();
	const desc = (input.description ?? '').toLowerCase();

	if (name.endsWith('-bot') || topics.some((t) => t.includes('bot'))) {
		return { category: 'bot', confidence: 0.85 };
	}

	if (
		paths.some((p) => p.includes('godot') || p.includes('unity') || p.endsWith('.love')) ||
		topics.some((t) => ['game', 'godot', 'unity', 'gamedev'].includes(t))
	) {
		return { category: 'game', confidence: 0.8 };
	}

	if (
		paths.some((p) => p.includes('dockerfile') || p.includes('.github/workflows')) ||
		topics.some((t) => ['devops', 'kubernetes', 'docker'].includes(t))
	) {
		return { category: 'devops', confidence: 0.75 };
	}

	if (
		paths.some((p) => p.endsWith('.ipynb') || p.includes('/notebooks/')) ||
		topics.some((t) => ['machine-learning', 'ml', 'pytorch', 'tensorflow'].includes(t))
	) {
		return { category: 'data-ml', confidence: 0.78 };
	}

	if (
		paths.some((p) => p.includes('cmd/') || p.includes('bin/')) ||
		readme.includes('command-line') ||
		topics.some((t) => ['cli', 'command-line'].includes(t))
	) {
		return { category: 'cli-tool', confidence: 0.72 };
	}

	if (
		paths.some((p) => p.startsWith('public/') || p.includes('next.config')) ||
		['JavaScript', 'TypeScript', 'Svelte', 'Vue'].includes(input.language ?? '') &&
			(readme.includes('npm run dev') || desc.includes('web app'))
	) {
		return { category: 'web-app', confidence: 0.7 };
	}

	if (
		paths.some((p) => p.includes('android') || p.includes('ios')) ||
		topics.includes('mobile')
	) {
		return { category: 'mobile-app', confidence: 0.68 };
	}

	if (readme.includes('documentation') && paths.length < 8) {
		return { category: 'docs-site', confidence: 0.65 };
	}

	if (name.includes('template') || topics.includes('template') || topics.includes('boilerplate')) {
		return { category: 'template', confidence: 0.7 };
	}

	if (
		paths.some((p) => p.startsWith('src/') || p.startsWith('lib/')) &&
		!readme.includes('getting started') &&
		(input.language === 'Rust' || input.language === 'Go' || input.language === 'Python')
	) {
		return { category: 'library', confidence: 0.6 };
	}

	return { category: 'other', confidence: 0.4 };
}
