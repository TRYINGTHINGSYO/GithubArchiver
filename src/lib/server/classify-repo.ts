import { CURRENT_SCORING_VERSION, confidenceBand, type ConfidenceBand } from './scoring-version';

/**
 * Primary category taxonomy (v2026.08.1).
 * Secondary concepts (capabilities / secondary clusters) live in cluster memberships.
 */
export const REPO_CATEGORIES = [
	'application',
	'product',
	'library',
	'framework',
	'developer-tool',
	'dataset',
	'documentation',
	'template',
	'personal-website',
	'company-profile',
	'portfolio-collection',
	'portfolio', // retained for stored values; prefer portfolio-collection / personal-website
	'school-assignment',
	'research-project',
	'awesome-list',
	'ai-project',
	'game',
	'bot',
	'devops',
	'security',
	'data-science',
	'mobile-app',
	'hardware-iot',
	'spam-template',
	'generated-content',
	'unknown'
] as const;

export type RepoCategory = (typeof REPO_CATEGORIES)[number];

/** Maps pre-v14 and intermediate taxonomy values to the current set. */
export const LEGACY_CATEGORY_MAP: Record<string, RepoCategory> = {
	'cli-tool': 'library',
	'web-app': 'application',
	'data-ml': 'data-science',
	'docs-site': 'documentation',
	other: 'unknown',
	// historical: bots were folded into product; new taxonomy restores `bot`
	// stored `product` values for bots are corrected on reclassify
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

export interface ClassificationEvidence {
	signal: string;
	weight: number;
	source: 'name' | 'description' | 'readme' | 'topics' | 'paths' | 'homepage' | 'meta';
	matchedText: string;
	polarity: 'positive' | 'negative';
}

export interface ClassifyRepoResult {
	category: RepoCategory;
	confidence: number;
	band: ConfidenceBand;
	scoringVersion: string;
	evidence: ClassificationEvidence[];
	warnings: string[];
}

type Matcher = (ctx: MatchContext) => { score: number; evidence: ClassificationEvidence[] };

interface MatchContext {
	name: string;
	owner: string;
	fullName: string;
	topics: string[];
	paths: string[];
	readme: string;
	desc: string;
	language: string | null;
	stars: number;
	forks: number;
	homepage: string;
	ownerType: string | null;
	blob: string;
}

const CATEGORY_PRIORITY: RepoCategory[] = [
	'school-assignment',
	'generated-content',
	'spam-template',
	'template',
	'awesome-list',
	'company-profile',
	'bot',
	'ai-project',
	'game',
	'hardware-iot',
	'mobile-app',
	'security',
	'devops',
	'data-science',
	'dataset',
	'research-project',
	'framework',
	'developer-tool',
	'library',
	'application',
	'product',
	'personal-website',
	'portfolio-collection',
	'portfolio',
	'documentation',
	'unknown'
];

const DATABASE_PLATFORM_NAME_RE =
	/\b(supabase|firebase|appwrite|pocketbase|hasura|prisma|drizzle|planetscale|neon\.tech|cockroachdb|mongodb|postgres|postgresql|mysql|redis|cassandra|elasticsearch|meilisearch|typesense|nhost|xata)\b/i;

const DATABASE_PLATFORM_TOPIC = new Set([
	'supabase',
	'firebase',
	'appwrite',
	'pocketbase',
	'hasura',
	'prisma',
	'drizzle',
	'postgres',
	'postgresql',
	'mysql',
	'mongodb',
	'redis',
	'database',
	'backend',
	'baas',
	'paas'
]);

const DATABASE_IDENTITY_RE =
	/\b(open source firebase alternative|backend.?as.?a.?service|postgres(ql)? (database|platform|backend)|database platform|self[- ]hosted backend|backend platform|auth(,| and) storage)\b/i;

const DEVELOPER_PRODUCT_TOPIC = new Set([
	'api-client',
	'api-platform',
	'api-testing',
	'developer-tools',
	'devtools',
	'graphql',
	'http-client',
	'postman',
	'rest-api'
]);

const DEVELOPER_PRODUCT_TEXT_RE =
	/\b(api (development|client|platform|testing|tool|tools)|developer tools?|devtools|graphql client|http client|postman alternative|request builder|rest client)\b/i;

const AI_APPLICATION_MENTION_RE =
	/\b(build (ai|llm|gpt)|ai (apps?|applications?|features?)|vector (embeddings?|search)|llm (apps?|applications?)|powered by ai|with ai)\b/i;

const AWESOME_LIST_NAME_RE = /\bawesome[-_]?/i;
const AWESOME_LIST_TEXT_RE =
	/\b(awesome[- ]list|curated list of|a curated list|list of awesome|self[- ]hosted software|software that can be self[- ]hosted)\b/i;

const BOT_SIGNAL_RE =
	/\b(telegram|discord|slack|whatsapp|trading)\b.*\bbot\b|\bbot\b.*\b(telegram|discord|slack|webhook|command handler|polling)\b|telegraf|discord\.?js|python-telegram-bot|bot token|webhook/i;

const LIBRARY_POSITIVE_RE =
	/\b(library|sdk|npm (package|module)|pip install|cargo add|go get|maven|published (crate|package)|reusable (module|package)|import \{)\b/i;

const COMPANY_PROFILE_RE =
	/\bcompany profile(\s*\(portfolio lead\))?|portfolio lead\b|company (name|profile)\b/i;

const PERSONAL_PORTFOLIO_SITE_RE =
	/\b(my |personal |professional )?(portfolio|resume|cv) (website|site|page)\b|\b(personal|professional) portfolio\b|\bgraphic design portfolio\b|\babout me\b/i;

const PORTFOLIO_NAME_AMBIGUOUS_RE =
	/\bportfolio[-_]?(data|mining|analytics|dataset|api|service|engine|research|interview|simulator)\b/i;

const NON_WEBSITE_PORTFOLIO_RE =
	/\b(data mining|dataset|interview simulator|machine learning|analytics platform|research)\b/i;

function evidence(
	signal: string,
	weight: number,
	source: ClassificationEvidence['source'],
	matchedText: string,
	polarity: ClassificationEvidence['polarity'] = 'positive'
): ClassificationEvidence {
	return { signal, weight, source, matchedText: matchedText.slice(0, 120), polarity };
}

function isAwesomeList(ctx: MatchContext): number {
	if (AWESOME_LIST_NAME_RE.test(ctx.name) || AWESOME_LIST_NAME_RE.test(ctx.fullName)) return 0.96;
	if (ctx.topics.some((t) => t === 'awesome' || t === 'awesome-list' || t.startsWith('awesome-'))) {
		return 0.94;
	}
	if (AWESOME_LIST_TEXT_RE.test(`${ctx.desc} ${ctx.readme}`)) return 0.9;
	if (ctx.name.includes('awesome') && /\b(list|curated|collection)\b/i.test(ctx.desc)) return 0.88;
	return 0;
}

function isDatabaseOrBackendPlatform(ctx: MatchContext): boolean {
	if (DATABASE_PLATFORM_NAME_RE.test(ctx.name) || DATABASE_PLATFORM_NAME_RE.test(ctx.fullName)) {
		return true;
	}
	if (ctx.topics.some((t) => DATABASE_PLATFORM_TOPIC.has(t))) return true;
	if (DATABASE_IDENTITY_RE.test(`${ctx.desc} ${ctx.readme}`)) return true;
	return false;
}

function isDeveloperProduct(ctx: MatchContext): number {
	const text = `${ctx.name} ${ctx.fullName} ${ctx.desc} ${ctx.readme}`;
	if (ctx.topics.some((topic) => DEVELOPER_PRODUCT_TOPIC.has(topic))) return 0.84;
	if (ctx.topics.includes('api') && DEVELOPER_PRODUCT_TEXT_RE.test(text)) return 0.82;
	if (DEVELOPER_PRODUCT_TEXT_RE.test(text)) return 0.8;
	return 0;
}

function hasIncidentalAiWording(ctx: MatchContext): boolean {
	return AI_APPLICATION_MENTION_RE.test(`${ctx.desc} ${ctx.readme}`);
}

function strongAiIdentity(ctx: MatchContext): number {
	const identityTopics = ctx.topics.filter((t) =>
		[
			'llm',
			'gpt',
			'openai',
			'claude',
			'mcp',
			'rag',
			'langchain',
			'langgraph',
			'crewai',
			'ai-agent',
			'autonomous-agent',
			'chatbot'
		].includes(t)
	);
	if (identityTopics.length > 0) return 0.9;

	if (
		/\b(llm|large language model|ai agent|mcp server|rag pipeline|langchain|langgraph|crewai|openai api|anthropic)\b/i.test(
			`${ctx.name} ${ctx.fullName}`
		)
	) {
		return 0.88;
	}

	if (
		/\b(llm (wrapper|client|sdk|server)|ai agent (framework|orchestr)|mcp server|retrieval[- ]augmented|langgraph|crewai|text[- ]to[- ]sql agent)\b/i.test(
			`${ctx.desc} ${ctx.readme}`
		)
	) {
		return 0.85;
	}

	if (ctx.name.endsWith('-mcp') || ctx.name.includes('mcp-server')) return 0.85;
	if (ctx.name.endsWith('-bot') && ctx.topics.some((t) => t.includes('ai') || t === 'llm')) {
		return 0.8;
	}

	return 0;
}

function weakAiMentionScore(ctx: MatchContext): number {
	// Generic standalone tokens contribute only weak support.
	if (ctx.topics.includes('ai') || ctx.topics.includes('machine-learning')) return 0.35;
	if (/\b(artificial intelligence|\bai\b)\b/i.test(ctx.desc) && !isDatabaseOrBackendPlatform(ctx)) {
		return 0.32;
	}
	if (hasIncidentalAiWording(ctx)) return 0.22;
	return 0;
}

function botSignalScore(ctx: MatchContext): { score: number; evidence: ClassificationEvidence[] } {
	const ev: ClassificationEvidence[] = [];
	const text = `${ctx.desc} ${ctx.readme}`;
	let score = 0;

	if (ctx.name.endsWith('-bot') || ctx.name.includes('-bot-') || /bot$/i.test(ctx.name)) {
		score = Math.max(score, 0.72);
		ev.push(evidence('bot-name-suffix', 0.72, 'name', ctx.name));
	}
	if (ctx.topics.some((t) => t.includes('bot') || t === 'telegram' || t === 'discord')) {
		score = Math.max(score, 0.78);
		ev.push(evidence('bot-topic', 0.78, 'topics', ctx.topics.filter((t) => t.includes('bot') || t === 'telegram' || t === 'discord').join(',')));
	}
	if (BOT_SIGNAL_RE.test(text) || BOT_SIGNAL_RE.test(ctx.name)) {
		score = Math.max(score, 0.88);
		ev.push(evidence('bot-runtime-signals', 0.88, 'readme', 'bot handlers / telegram|discord|webhook'));
	}
	if (/\b(command handler|bot token|webhook|polling|telegraf|discord\.js)\b/i.test(text)) {
		score = Math.max(score, 0.9);
		ev.push(evidence('bot-entrypoints', 0.9, 'readme', 'command handler / token / webhook'));
	}
	return { score, evidence: ev };
}

function libraryPositiveScore(ctx: MatchContext): { score: number; evidence: ClassificationEvidence[] } {
	const ev: ClassificationEvidence[] = [];
	let score = 0;
	if (ctx.topics.includes('library') || ctx.topics.includes('package') || ctx.topics.includes('sdk')) {
		score = Math.max(score, 0.8);
		ev.push(evidence('library-topic', 0.8, 'topics', 'library|package|sdk'));
	}
	if (LIBRARY_POSITIVE_RE.test(`${ctx.desc} ${ctx.readme}`)) {
		score = Math.max(score, 0.74);
		ev.push(evidence('library-readme-language', 0.74, 'readme', 'package/install/API wording'));
	}
	if (
		ctx.paths.some((p) =>
			['package.json', 'pyproject.toml', 'cargo.toml', 'go.mod', 'setup.py'].some((f) =>
				p.endsWith(f)
			)
		) &&
		!BOT_SIGNAL_RE.test(`${ctx.desc} ${ctx.readme} ${ctx.name}`)
	) {
		score = Math.max(score, 0.7);
		ev.push(evidence('package-manifest', 0.7, 'paths', 'package manifest'));
	}
	if (
		ctx.paths.some((p) => p.startsWith('src/') || p.startsWith('lib/') || p.startsWith('pkg/')) &&
		!ctx.readme.includes('npm run dev') &&
		(ctx.language === 'Rust' || ctx.language === 'Go' || ctx.language === 'Python') &&
		!BOT_SIGNAL_RE.test(`${ctx.name} ${ctx.desc}`)
	) {
		score = Math.max(score, 0.62);
		ev.push(evidence('lib-layout', 0.62, 'paths', 'src|lib|pkg'));
	}
	return { score, evidence: ev };
}

const CATEGORY_MATCHERS: Record<RepoCategory, Matcher[]> = {
	'school-assignment': [
		(ctx) =>
			ctx.topics.includes('github-classroom')
				? { score: 0.95, evidence: [evidence('classroom-topic', 0.95, 'topics', 'github-classroom')] }
				: { score: 0, evidence: [] },
		(ctx) =>
			ctx.paths.some((p) => p.includes('.github/classroom'))
				? { score: 0.9, evidence: [evidence('classroom-path', 0.9, 'paths', '.github/classroom')] }
				: { score: 0, evidence: [] },
		(ctx) =>
			/\b(homework|assignment|coursework|lab-?\d|project-\d|cs\d{3,4}|classroom)\b/i.test(
				`${ctx.name} ${ctx.desc} ${ctx.readme}`
			)
				? {
						score: 0.82,
						evidence: [evidence('assignment-language', 0.82, 'description', 'assignment/coursework')]
					}
				: { score: 0, evidence: [] },
		(ctx) =>
			/^(hw|lab|assignment|project)[-_]?\d*$/i.test(ctx.name)
				? { score: 0.78, evidence: [evidence('assignment-name', 0.78, 'name', ctx.name)] }
				: { score: 0, evidence: [] }
	],
	'generated-content': [
		(ctx) =>
			COMPANY_PROFILE_RE.test(ctx.desc) && /company profile/i.test(ctx.desc)
				? {
						score: 0.55,
						evidence: [
							evidence('templated-company-profile', 0.55, 'description', ctx.desc.slice(0, 80))
						]
					}
				: { score: 0, evidence: [] }
	],
	'spam-template': [
		(ctx) =>
			ctx.name.includes('template') || ctx.topics.includes('template')
				? { score: 0.88, evidence: [evidence('template-token', 0.88, 'name', ctx.name)] }
				: { score: 0, evidence: [] },
		(ctx) =>
			ctx.topics.includes('boilerplate') || ctx.topics.includes('starter')
				? { score: 0.85, evidence: [evidence('boilerplate-topic', 0.85, 'topics', 'boilerplate|starter')] }
				: { score: 0, evidence: [] },
		(ctx) =>
			/\b(cookiecutter|scaffold|starter-kit|boilerplate|hello-world)\b/i.test(`${ctx.name} ${ctx.desc}`)
				? { score: 0.75, evidence: [evidence('scaffold-language', 0.75, 'description', 'scaffold')] }
				: { score: 0, evidence: [] }
	],
	template: [
		(ctx) =>
			ctx.topics.includes('template') && !ctx.name.includes('awesome')
				? { score: 0.7, evidence: [evidence('template-topic', 0.7, 'topics', 'template')] }
				: { score: 0, evidence: [] }
	],
	'awesome-list': [
		(ctx) => {
			const score = isAwesomeList(ctx);
			return score > 0
				? { score, evidence: [evidence('awesome-list', score, 'name', ctx.name)] }
				: { score: 0, evidence: [] };
		}
	],
	'company-profile': [
		(ctx) =>
			COMPANY_PROFILE_RE.test(ctx.desc)
				? {
						score: 0.92,
						evidence: [
							evidence('company-profile-template', 0.92, 'description', ctx.desc.slice(0, 100))
						]
					}
				: { score: 0, evidence: [] },
		(ctx) =>
			/\b(company profile|organization profile|business profile)\b/i.test(ctx.readme)
				? { score: 0.8, evidence: [evidence('company-profile-readme', 0.8, 'readme', 'company profile')] }
				: { score: 0, evidence: [] }
	],
	bot: [(ctx) => botSignalScore(ctx)],
	'ai-project': [
		(ctx) => {
			if (isAwesomeList(ctx) > 0) return { score: 0, evidence: [] };
			if (isDatabaseOrBackendPlatform(ctx)) {
				const weak = weakAiMentionScore(ctx);
				return {
					score: Math.min(0.35, weak),
					evidence: [evidence('weak-ai-on-platform', Math.min(0.35, weak), 'description', 'incidental AI')]
				};
			}
			const strong = strongAiIdentity(ctx);
			if (strong > 0) {
				return { score: strong, evidence: [evidence('strong-ai-identity', strong, 'topics', 'ai identity')] };
			}
			const weak = weakAiMentionScore(ctx);
			return weak > 0
				? { score: weak, evidence: [evidence('weak-ai-mention', weak, 'description', 'generic ai/ml')] }
				: { score: 0, evidence: [] };
		}
	],
	game: [
		(ctx) =>
			ctx.topics.some((t) => ['game', 'godot', 'unity', 'gamedev', 'roblox', 'minecraft'].includes(t))
				? { score: 0.85, evidence: [evidence('game-topic', 0.85, 'topics', 'game')] }
				: { score: 0, evidence: [] },
		(ctx) =>
			/\b(unity|godot|unreal|roblox)\b/i.test(ctx.desc)
				? { score: 0.72, evidence: [evidence('game-engine', 0.72, 'description', 'engine')] }
				: { score: 0, evidence: [] }
	],
	'hardware-iot': [
		(ctx) =>
			ctx.topics.some((t) =>
				['arduino', 'raspberry-pi', 'esp32', 'iot', 'embedded', 'firmware', 'hardware'].includes(t)
			)
				? { score: 0.88, evidence: [evidence('iot-topic', 0.88, 'topics', 'iot')] }
				: { score: 0, evidence: [] }
	],
	'mobile-app': [
		(ctx) =>
			ctx.topics.some((t) =>
				['mobile', 'android', 'ios', 'flutter', 'react-native', 'swift', 'kotlin'].includes(t)
			)
				? { score: 0.82, evidence: [evidence('mobile-topic', 0.82, 'topics', 'mobile')] }
				: { score: 0, evidence: [] }
	],
	security: [
		(ctx) =>
			ctx.topics.some((t) =>
				['security', 'cybersecurity', 'pentest', 'ctf', 'vulnerability', 'malware'].includes(t)
			)
				? { score: 0.88, evidence: [evidence('security-topic', 0.88, 'topics', 'security')] }
				: { score: 0, evidence: [] }
	],
	devops: [
		(ctx) =>
			ctx.topics.some((t) =>
				['devops', 'kubernetes', 'docker', 'terraform', 'ansible', 'ci-cd', 'infrastructure'].includes(t)
			)
				? { score: 0.85, evidence: [evidence('devops-topic', 0.85, 'topics', 'devops')] }
				: { score: 0, evidence: [] }
	],
	'data-science': [
		(ctx) =>
			ctx.topics.some((t) =>
				['machine-learning', 'ml', 'data-science', 'pytorch', 'tensorflow', 'pandas', 'jupyter'].includes(
					t
				)
			)
				? { score: 0.85, evidence: [evidence('ds-topic', 0.85, 'topics', 'data-science')] }
				: { score: 0, evidence: [] },
		(ctx) =>
			ctx.language === 'Jupyter Notebook'
				? { score: 0.8, evidence: [evidence('jupyter', 0.8, 'meta', 'Jupyter Notebook')] }
				: { score: 0, evidence: [] }
	],
	dataset: [
		(ctx) =>
			ctx.topics.includes('dataset') || /\b(dataset|data dump|corpus)\b/i.test(ctx.desc)
				? { score: 0.86, evidence: [evidence('dataset', 0.86, 'description', 'dataset')] }
				: { score: 0, evidence: [] }
	],
	'research-project': [
		(ctx) =>
			/\b(research (project|paper)|arxiv|preprint|replication study)\b/i.test(`${ctx.desc} ${ctx.readme}`)
				? { score: 0.8, evidence: [evidence('research', 0.8, 'description', 'research')] }
				: { score: 0, evidence: [] }
	],
	framework: [
		(ctx) =>
			ctx.topics.includes('framework')
				? { score: 0.88, evidence: [evidence('framework-topic', 0.88, 'topics', 'framework')] }
				: { score: 0, evidence: [] },
		(ctx) =>
			/\b(framework|sdk for|developer toolkit)\b/i.test(`${ctx.desc} ${ctx.readme}`) && ctx.stars >= 10
				? { score: 0.75, evidence: [evidence('framework-language', 0.75, 'description', 'framework')] }
				: { score: 0, evidence: [] }
	],
	'developer-tool': [
		(ctx) => {
			const score = isDeveloperProduct(ctx);
			return score > 0
				? { score, evidence: [evidence('developer-tool', score, 'description', 'devtools')] }
				: { score: 0, evidence: [] };
		}
	],
	library: [
		(ctx) => {
			// Bots / runnable apps must not win as libraries without package evidence.
			const bot = botSignalScore(ctx);
			if (bot.score >= 0.72) {
				return {
					score: 0,
					evidence: [
						evidence('bot-excludes-library', -bot.score, 'name', ctx.name, 'negative')
					]
				};
			}
			return libraryPositiveScore(ctx);
		}
	],
	application: [
		(ctx) =>
			ctx.paths.some(
				(p) =>
					p.includes('next.config') ||
					p.includes('vite.config') ||
					p.includes('app/routes/') ||
					p.includes('pages/api/')
			)
				? { score: 0.78, evidence: [evidence('app-framework-config', 0.78, 'paths', 'app config')] }
				: { score: 0, evidence: [] },
		(ctx) =>
			['JavaScript', 'TypeScript', 'Svelte', 'Vue', 'Python'].includes(ctx.language ?? '') &&
			(ctx.readme.includes('npm run dev') ||
				ctx.desc.includes('web app') ||
				ctx.topics.includes('webapp'))
				? { score: 0.72, evidence: [evidence('runnable-app', 0.72, 'readme', 'npm run dev / web app')] }
				: { score: 0, evidence: [] }
	],
	product: [
		(ctx) => {
			if (isAwesomeList(ctx) > 0) return { score: 0, evidence: [] };
			if (isDatabaseOrBackendPlatform(ctx)) {
				return {
					score: 0.86,
					evidence: [evidence('database-platform', 0.86, 'name', ctx.name)]
				};
			}
			const developerProductScore = isDeveloperProduct(ctx);
			if (developerProductScore > 0) {
				return {
					score: developerProductScore,
					evidence: [evidence('developer-product', developerProductScore, 'topics', 'devtools')]
				};
			}
			return { score: 0, evidence: [] };
		},
		(ctx) =>
			ctx.desc.includes('saas') || ctx.topics.includes('saas')
				? { score: 0.74, evidence: [evidence('saas', 0.74, 'description', 'saas')] }
				: { score: 0, evidence: [] },
		(ctx) =>
			ctx.homepage && !ctx.homepage.includes('github.io')
				? { score: 0.65, evidence: [evidence('deployed-homepage', 0.65, 'homepage', ctx.homepage)] }
				: { score: 0, evidence: [] },
		(ctx) =>
			ctx.ownerType === 'Organization' && ctx.stars >= 20
				? { score: 0.55, evidence: [evidence('org-popularity', 0.55, 'meta', 'org stars')] }
				: { score: 0, evidence: [] }
	],
	'personal-website': [
		(ctx) => {
			if (isAwesomeList(ctx) > 0) return { score: 0, evidence: [] };
			if (COMPANY_PROFILE_RE.test(ctx.desc)) return { score: 0, evidence: [] };
			if (PORTFOLIO_NAME_AMBIGUOUS_RE.test(ctx.name) && NON_WEBSITE_PORTFOLIO_RE.test(ctx.desc)) {
				return { score: 0, evidence: [] };
			}
			if (PERSONAL_PORTFOLIO_SITE_RE.test(`${ctx.desc} ${ctx.readme}`)) {
				return {
					score: 0.9,
					evidence: [
						evidence('personal-portfolio-site', 0.9, 'description', ctx.desc.slice(0, 80))
					]
				};
			}
			return { score: 0, evidence: [] };
		},
		(ctx) => {
			if (isAwesomeList(ctx) > 0) return { score: 0, evidence: [] };
			return ctx.paths.some(
				(p) =>
					p.includes('_config.yml') ||
					p.includes('hugo.toml') ||
					p.includes('gatsby-config') ||
					p.includes('astro.config')
			)
				? { score: 0.8, evidence: [evidence('static-site-config', 0.8, 'paths', 'static site')] }
				: { score: 0, evidence: [] };
		},
		(ctx) => {
			if (isAwesomeList(ctx) > 0) return { score: 0, evidence: [] };
			return /\b(blog|personal website|my site)\b/i.test(`${ctx.desc} ${ctx.readme}`)
				? { score: 0.75, evidence: [evidence('personal-site-language', 0.75, 'description', 'personal site')] }
				: { score: 0, evidence: [] };
		},
		(ctx) =>
			isAwesomeList(ctx) > 0
				? { score: 0, evidence: [] }
				: ctx.name === ctx.owner && ctx.paths.length < 30
					? { score: 0.68, evidence: [evidence('owner-named-site', 0.68, 'name', ctx.name)] }
					: { score: 0, evidence: [] }
	],
	'portfolio-collection': [
		(ctx) =>
			/\b(portfolio of (projects|work)|collection of (projects|case studies)|project showcase)\b/i.test(
				`${ctx.desc} ${ctx.readme}`
			)
				? {
						score: 0.84,
						evidence: [evidence('portfolio-collection', 0.84, 'description', 'collection')]
					}
				: { score: 0, evidence: [] }
	],
	portfolio: [
		(ctx) => {
			if (isAwesomeList(ctx) > 0) return { score: 0, evidence: [] };
			if (COMPANY_PROFILE_RE.test(ctx.desc)) return { score: 0, evidence: [] };
			if (PERSONAL_PORTFOLIO_SITE_RE.test(`${ctx.desc} ${ctx.readme}`)) {
				// Prefer personal-website for site-oriented wording.
				return { score: 0, evidence: [] };
			}
			if (PORTFOLIO_NAME_AMBIGUOUS_RE.test(ctx.name)) {
				return {
					score: 0,
					evidence: [
						evidence('ambiguous-portfolio-name', -0.5, 'name', ctx.name, 'negative')
					]
				};
			}
			if (NON_WEBSITE_PORTFOLIO_RE.test(ctx.desc) && ctx.name.includes('portfolio')) {
				return {
					score: 0,
					evidence: [
						evidence('portfolio-token-overridden', -0.6, 'description', ctx.desc.slice(0, 80), 'negative')
					]
				};
			}
			// Require site-like evidence; bare name token "portfolio" is insufficient.
			if (
				ctx.topics.includes('portfolio') &&
				(ctx.homepage.includes('github.io') ||
					/\b(website|site|page|resume|cv)\b/i.test(`${ctx.desc} ${ctx.readme}`))
			) {
				return { score: 0.8, evidence: [evidence('portfolio-topic-site', 0.8, 'topics', 'portfolio')] };
			}
			if (
				/\b(resume|cv)\b/i.test(`${ctx.desc} ${ctx.readme}`) &&
				/\b(website|site|page)\b/i.test(`${ctx.desc} ${ctx.readme}`)
			) {
				return { score: 0.78, evidence: [evidence('resume-site', 0.78, 'description', 'resume site')] };
			}
			return { score: 0, evidence: [] };
		}
	],
	documentation: [
		(ctx) =>
			ctx.topics.includes('documentation') ||
			(/\b(documentation site|docs site|documentation only)\b/i.test(ctx.desc) &&
				!LIBRARY_POSITIVE_RE.test(ctx.readme))
				? { score: 0.78, evidence: [evidence('docs', 0.78, 'description', 'documentation')] }
				: { score: 0, evidence: [] }
	],
	unknown: [() => ({ score: 0.35, evidence: [] })]
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
		fullName: input.full_name.toLowerCase(),
		topics: input.topics.map((t) => t.toLowerCase()),
		paths: (input.filePaths ?? []).map((p) => p.toLowerCase()),
		readme: (input.readmeExcerpt ?? '').toLowerCase(),
		desc: (input.description ?? '').toLowerCase(),
		language: input.language,
		stars: input.stars ?? 0,
		forks: input.forks ?? 0,
		homepage: (input.homepage ?? '').toLowerCase(),
		ownerType: input.owner_type ?? null,
		blob: ''
	};
	ctx.blob = `${ctx.name} ${ctx.fullName} ${ctx.desc} ${ctx.readme} ${ctx.topics.join(' ')}`;

	const scores = new Map<RepoCategory, number>();
	const evidenceByCategory = new Map<RepoCategory, ClassificationEvidence[]>();

	for (const category of REPO_CATEGORIES) {
		if (category === 'unknown') continue;
		const matchers = CATEGORY_MATCHERS[category];
		let best = 0;
		let bestEv: ClassificationEvidence[] = [];
		for (const match of matchers) {
			const result = match(ctx);
			if (result.score > best) {
				best = result.score;
				bestEv = result.evidence;
			}
		}
		if (best > 0) {
			scores.set(category, best);
			evidenceByCategory.set(category, bestEv);
		}
	}

	if (scores.size === 0) {
		return {
			category: 'unknown',
			confidence: 0.35,
			band: confidenceBand(0.35),
			scoringVersion: CURRENT_SCORING_VERSION,
			evidence: [],
			warnings: ['no-positive-category-signals']
		};
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

	if (winner === 'ai-project' && bestScore < 0.55) {
		const runnerUp = [...scores.entries()]
			.filter(([cat]) => cat !== 'ai-project')
			.sort((a, b) => b[1] - a[1])[0];
		if (runnerUp && runnerUp[1] >= 0.55) {
			winner = runnerUp[0];
			bestScore = runnerUp[1];
		} else if (bestScore < 0.5) {
			return {
				category: 'unknown',
				confidence: 0.4,
				band: confidenceBand(0.4),
				scoringVersion: CURRENT_SCORING_VERSION,
				evidence: evidenceByCategory.get('ai-project') ?? [],
				warnings: ['weak-ai-signal-demoted']
			};
		}
	}

	const confidence = Math.min(0.95, Math.round((0.38 + bestScore * 0.57) * 100) / 100);
	const warnings: string[] = [];
	if (confidence < 0.55) warnings.push('review-required-confidence');
	if (winner === 'library' && botSignalScore(ctx).score >= 0.5) {
		warnings.push('library-with-bot-signals');
	}

	return {
		category: winner,
		confidence,
		band: confidenceBand(confidence),
		scoringVersion: CURRENT_SCORING_VERSION,
		evidence: evidenceByCategory.get(winner) ?? [],
		warnings
	};
}
