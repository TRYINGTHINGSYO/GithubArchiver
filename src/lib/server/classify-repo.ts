export const REPO_CATEGORIES = [
	'product',
	'library',
	'framework',
	'personal-website',
	'portfolio',
	'school-assignment',
	'ai-project',
	'game',
	'devops',
	'security',
	'data-science',
	'mobile-app',
	'hardware-iot',
	'spam-template',
	'unknown'
] as const;

export type RepoCategory = (typeof REPO_CATEGORIES)[number];

/** Maps pre-v14 taxonomy values to the current set. */
export const LEGACY_CATEGORY_MAP: Record<string, RepoCategory> = {
	bot: 'product',
	'cli-tool': 'library',
	'web-app': 'product',
	'data-ml': 'data-science',
	'docs-site': 'personal-website',
	template: 'spam-template',
	other: 'unknown'
};

export interface ClassifyRepoInput {
	owner: string;
	name: string;
	full_name: string;
	description: string | null;
	language: string | null;
	topics: string[];
	stars: number | null;
	forks: number | null;
	homepage?: string | null;
	owner_type?: string | null;
	github_archived?: boolean;
	readmeExcerpt?: string | null;
	filePaths?: string[];
}

export interface ClassifyRepoResult {
	category: RepoCategory;
	confidence: number;
}

type Matcher = (ctx: MatchContext) => number;

interface MatchContext {
	name: string;
	owner: string;
	topics: string[];
	paths: string[];
	readme: string;
	desc: string;
	language: string | null;
	stars: number;
	forks: number;
	homepage: string;
	ownerType: string | null;
}

const CATEGORY_PRIORITY: RepoCategory[] = [
	'school-assignment',
	'spam-template',
	'ai-project',
	'game',
	'hardware-iot',
	'mobile-app',
	'security',
	'devops',
	'data-science',
	'framework',
	'library',
	'product',
	'portfolio',
	'personal-website',
	'unknown'
];

const CATEGORY_MATCHERS: Record<RepoCategory, Matcher[]> = {
	'school-assignment': [
		(ctx) => (ctx.topics.includes('github-classroom') ? 0.95 : 0),
		(ctx) => (ctx.paths.some((p) => p.includes('.github/classroom')) ? 0.9 : 0),
		(ctx) =>
			/\b(homework|assignment|coursework|lab-?\d|project-\d|cs\d{3,4}|classroom)\b/i.test(
				`${ctx.name} ${ctx.desc} ${ctx.readme}`
			)
				? 0.82
				: 0,
		(ctx) => (/^(hw|lab|assignment|project)[-_]?\d*$/i.test(ctx.name) ? 0.78 : 0)
	],
	'spam-template': [
		(ctx) => (ctx.name.includes('template') || ctx.topics.includes('template') ? 0.88 : 0),
		(ctx) => (ctx.topics.includes('boilerplate') || ctx.topics.includes('starter') ? 0.85 : 0),
		(ctx) =>
			/\b(cookiecutter|scaffold|starter-kit|boilerplate|hello-world)\b/i.test(
				`${ctx.name} ${ctx.desc}`
			)
				? 0.75
				: 0,
		(ctx) => (ctx.name === 'hello-world' && ctx.stars < 5 ? 0.7 : 0)
	],
	'ai-project': [
		(ctx) =>
			ctx.topics.some((t) =>
				['ai', 'llm', 'gpt', 'openai', 'claude', 'mcp', 'rag', 'agent', 'chatbot', 'langchain'].includes(t)
			)
				? 0.9
				: 0,
		(ctx) =>
			/\b(llm|large language model|ai agent|mcp server|rag pipeline|openai|anthropic|langchain)\b/i.test(
				`${ctx.desc} ${ctx.readme}`
			)
				? 0.82
				: 0,
		(ctx) => (ctx.name.endsWith('-bot') && ctx.topics.some((t) => t.includes('ai')) ? 0.8 : 0),
		(ctx) => (ctx.name.endsWith('-mcp') || ctx.name.includes('mcp-server') ? 0.85 : 0)
	],
	game: [
		(ctx) =>
			ctx.paths.some((p) => p.includes('godot') || p.includes('unity') || p.endsWith('.love'))
				? 0.88
				: 0,
		(ctx) =>
			ctx.topics.some((t) => ['game', 'godot', 'unity', 'gamedev', 'roblox', 'minecraft'].includes(t))
				? 0.85
				: 0,
		(ctx) => (/\b(unity|godot|unreal|roblox)\b/i.test(ctx.desc) ? 0.72 : 0)
	],
	'hardware-iot': [
		(ctx) =>
			ctx.topics.some((t) =>
				['arduino', 'raspberry-pi', 'esp32', 'iot', 'embedded', 'firmware', 'hardware'].includes(t)
			)
				? 0.88
				: 0,
		(ctx) =>
			ctx.paths.some((p) => p.includes('platformio') || p.includes('.ino') || p.includes('firmware/'))
				? 0.82
				: 0,
		(ctx) => (/\b(arduino|esp32|raspberry pi|embedded|firmware)\b/i.test(`${ctx.desc} ${ctx.readme}`) ? 0.75 : 0)
	],
	'mobile-app': [
		(ctx) =>
			ctx.paths.some(
				(p) =>
					p.includes('android') ||
					p.includes('ios/') ||
					p.includes('flutter/') ||
					p.includes('react-native')
			)
				? 0.85
				: 0,
		(ctx) =>
			ctx.topics.some((t) =>
				['mobile', 'android', 'ios', 'flutter', 'react-native', 'swift', 'kotlin'].includes(t)
			)
				? 0.82
				: 0
	],
	security: [
		(ctx) =>
			ctx.topics.some((t) =>
				['security', 'cybersecurity', 'pentest', 'ctf', 'vulnerability', 'malware'].includes(t)
			)
				? 0.88
				: 0,
		(ctx) =>
			/\b(penetration test|vulnerability|exploit|ctf|malware|security audit)\b/i.test(
				`${ctx.desc} ${ctx.readme}`
			)
				? 0.78
				: 0,
		(ctx) => (ctx.paths.some((p) => p.includes('security.md') || p.includes('.github/security')) ? 0.55 : 0)
	],
	devops: [
		(ctx) =>
			ctx.paths.some(
				(p) =>
					p.includes('dockerfile') ||
					p.includes('.github/workflows') ||
					p.includes('terraform') ||
					p.includes('ansible')
			)
				? 0.82
				: 0,
		(ctx) =>
			ctx.topics.some((t) =>
				['devops', 'kubernetes', 'docker', 'terraform', 'ansible', 'ci-cd', 'infrastructure'].includes(t)
			)
				? 0.85
				: 0
	],
	'data-science': [
		(ctx) =>
			ctx.paths.some((p) => p.endsWith('.ipynb') || p.includes('/notebooks/') || p.includes('/data/'))
				? 0.82
				: 0,
		(ctx) =>
			ctx.topics.some((t) =>
				[
					'machine-learning',
					'ml',
					'data-science',
					'pytorch',
					'tensorflow',
					'pandas',
					'jupyter'
				].includes(t)
			)
				? 0.85
				: 0,
		(ctx) => (ctx.language === 'Jupyter Notebook' ? 0.8 : 0)
	],
	framework: [
		(ctx) => (ctx.topics.includes('framework') ? 0.88 : 0),
		(ctx) =>
			/\b(framework|sdk for|developer toolkit)\b/i.test(`${ctx.desc} ${ctx.readme}`) &&
			ctx.stars >= 10
				? 0.75
				: 0,
		(ctx) =>
			ctx.paths.some((p) => p.includes('/examples/') || p.includes('/docs/')) &&
			ctx.paths.some((p) => p.startsWith('packages/') || p.startsWith('crates/'))
				? 0.65
				: 0
	],
	library: [
		(ctx) => (ctx.topics.includes('library') || ctx.topics.includes('package') ? 0.8 : 0),
		(ctx) =>
			ctx.paths.some((p) => p.startsWith('src/') || p.startsWith('lib/') || p.startsWith('pkg/')) &&
			!ctx.readme.includes('npm run dev') &&
			(ctx.language === 'Rust' || ctx.language === 'Go' || ctx.language === 'Python')
				? 0.62
				: 0,
		(ctx) =>
			/\b(library|package|npm module|pip install|cargo crate)\b/i.test(`${ctx.desc} ${ctx.readme}`)
				? 0.7
				: 0,
		(ctx) => (ctx.paths.some((p) => p.includes('cmd/') || p.includes('bin/')) ? 0.68 : 0),
		(ctx) => (ctx.name.endsWith('-bot') && ctx.stars < 50 ? 0.6 : 0)
	],
	product: [
		(ctx) =>
			ctx.paths.some(
				(p) =>
					p.includes('next.config') ||
					p.includes('vite.config') ||
					p.includes('app/routes/') ||
					p.includes('pages/api/')
			)
				? 0.78
				: 0,
		(ctx) =>
			['JavaScript', 'TypeScript', 'Svelte', 'Vue', 'Python'].includes(ctx.language ?? '') &&
			(ctx.readme.includes('npm run dev') ||
				ctx.desc.includes('web app') ||
				ctx.desc.includes('saas') ||
				ctx.topics.includes('saas'))
				? 0.72
				: 0,
		(ctx) => (ctx.homepage && !ctx.homepage.includes('github.io') ? 0.65 : 0),
		(ctx) => (ctx.ownerType === 'Organization' && ctx.stars >= 20 ? 0.55 : 0),
		(ctx) => (ctx.name.endsWith('-bot') && ctx.stars >= 5 ? 0.7 : 0)
	],
	portfolio: [
		(ctx) =>
			/\b(portfolio|resume|cv|personal site|about me)\b/i.test(`${ctx.name} ${ctx.desc} ${ctx.readme}`)
				? 0.85
				: 0,
		(ctx) => (ctx.topics.includes('portfolio') ? 0.88 : 0),
		(ctx) =>
			ctx.homepage.includes('github.io') &&
			ctx.paths.some((p) => p.includes('index.html') || p.includes('_config.yml'))
				? 0.7
				: 0
	],
	'personal-website': [
		(ctx) =>
			ctx.paths.some(
				(p) =>
					p.includes('_config.yml') ||
					p.includes('hugo.toml') ||
					p.includes('gatsby-config') ||
					p.includes('astro.config')
			)
				? 0.8
				: 0,
		(ctx) =>
			/\b(blog|personal website|my site|jekyll|hugo|gatsby)\b/i.test(`${ctx.desc} ${ctx.readme}`)
				? 0.75
				: 0,
		(ctx) => (ctx.name === ctx.owner && ctx.paths.length < 30 ? 0.68 : 0),
		(ctx) =>
			ctx.readme.includes('documentation') && ctx.paths.length < 8 && !ctx.topics.includes('library')
				? 0.6
				: 0
	],
	unknown: [() => 0.35]
};

export function normalizeCategory(category: string | null | undefined): RepoCategory | null {
	if (!category) return null;
	if ((REPO_CATEGORIES as readonly string[]).includes(category)) return category as RepoCategory;
	return LEGACY_CATEGORY_MAP[category] ?? null;
}

export function classifyRepo(input: ClassifyRepoInput): ClassifyRepoResult {
	const ctx: MatchContext = {
		name: input.name.toLowerCase(),
		owner: input.owner.toLowerCase(),
		topics: input.topics.map((t) => t.toLowerCase()),
		paths: (input.filePaths ?? []).map((p) => p.toLowerCase()),
		readme: (input.readmeExcerpt ?? '').toLowerCase(),
		desc: (input.description ?? '').toLowerCase(),
		language: input.language,
		stars: input.stars ?? 0,
		forks: input.forks ?? 0,
		homepage: (input.homepage ?? '').toLowerCase(),
		ownerType: input.owner_type ?? null
	};

	const scores = new Map<RepoCategory, number>();

	for (const category of REPO_CATEGORIES) {
		if (category === 'unknown') continue;
		const matchers = CATEGORY_MATCHERS[category];
		let best = 0;
		for (const match of matchers) {
			best = Math.max(best, match(ctx));
		}
		if (best > 0) scores.set(category, best);
	}

	if (scores.size === 0) {
		return { category: 'unknown', confidence: 0.35 };
	}

	let winner: RepoCategory = 'unknown';
	let bestScore = 0;

	for (const category of CATEGORY_PRIORITY) {
		const score = scores.get(category);
		if (score != null && score > bestScore) {
			bestScore = score;
			winner = category;
		}
	}

	const confidence = Math.min(0.95, Math.round((0.38 + bestScore * 0.57) * 100) / 100);
	return { category: winner, confidence };
}
