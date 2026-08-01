import type { RepoCategory } from '$lib/server/classify-repo';

/** Bump when cluster rules change; repos below this version are re-clustered. */
export const CURRENT_CLUSTER_VERSION = 3;

export type ClusterDefinition = {
	slug: string;
	name: string;
	description?: string;
	categories?: RepoCategory[];
	topicPatterns?: string[];
	/** Strong positive text evidence (full weight). */
	textPatterns?: RegExp[];
	/** Weak supporting text — never enough alone to clear minimumScore. */
	weakTextPatterns?: RegExp[];
	filePatterns?: RegExp[];
	languagePatterns?: string[];
	/** Reject the cluster when these dominate the repo identity. */
	negativeTextPatterns?: RegExp[];
	negativeTopicPatterns?: string[];
	/**
	 * When true, language / weak text alone cannot clear the threshold —
	 * at least one strong topic, name, readme, or file signal is required.
	 */
	requireStrongEvidence?: boolean;
	minimumScore: number;
};

export const CLUSTER_DEFINITIONS: ClusterDefinition[] = [
	{
		slug: 'mcp-servers',
		name: 'MCP Servers',
		description: 'Model Context Protocol servers and tool hosts.',
		categories: ['ai-project', 'library', 'product', 'application', 'bot', 'developer-tool'],
		topicPatterns: ['mcp', 'model-context-protocol'],
		textPatterns: [
			/model context protocol/i,
			/\bmcp server\b/i,
			/@modelcontextprotocol/i
		],
		filePatterns: [/mcp/i, /tools\.ts$/],
		minimumScore: 0.45
	},
	{
		slug: 'rag-applications',
		name: 'RAG Applications',
		description: 'Retrieval-augmented generation pipelines and apps.',
		categories: ['ai-project', 'product', 'library', 'application'],
		topicPatterns: ['rag', 'retrieval-augmented-generation', 'vector-search'],
		textPatterns: [/\brag\b/i, /retrieval[- ]augmented/i, /vector (store|database|search)/i],
		minimumScore: 0.45
	},
	{
		slug: 'ai-agents',
		name: 'AI Agents',
		description: 'Autonomous agents, orchestrators, and agent frameworks.',
		categories: ['ai-project', 'product', 'library', 'framework', 'application', 'bot'],
		topicPatterns: ['ai-agent', 'autonomous-agent', 'langgraph', 'crewai'],
		textPatterns: [/\bai agent/i, /autonomous agent/i, /agent orchestr/i, /multi-agent/i],
		weakTextPatterns: [/\bagent\b/i],
		requireStrongEvidence: true,
		minimumScore: 0.45
	},
	{
		slug: 'llm-wrappers',
		name: 'LLM Wrappers',
		description: 'Thin clients and SDKs around large language models.',
		categories: ['ai-project', 'library', 'product', 'developer-tool'],
		topicPatterns: ['openai', 'chatgpt', 'anthropic', 'claude'],
		textPatterns: [/large language model/i, /openai api/i, /chat completion/i, /\bllm (wrapper|client|sdk)\b/i],
		weakTextPatterns: [/\bllm\b/i, /\bgpt\b/i],
		requireStrongEvidence: true,
		minimumScore: 0.45
	},
	{
		slug: 'discord-bots',
		name: 'Discord Bots',
		description: 'Discord bots and Discord.js integrations.',
		categories: ['bot', 'application', 'product', 'ai-project'],
		topicPatterns: ['discord', 'discord-bot', 'discordjs'],
		textPatterns: [/\bdiscord\.?js\b/i, /discord bot/i, /discord\.com\/api/i],
		filePatterns: [/discord/i],
		minimumScore: 0.45
	},
	{
		slug: 'telegram-bots',
		name: 'Telegram Bots',
		description: 'Telegram bots and Telegram API clients.',
		categories: ['bot', 'application', 'product', 'ai-project'],
		topicPatterns: ['telegram', 'telegram-bot', 'telebot'],
		textPatterns: [/\btelegram bot/i, /telegraf/i, /python-telegram-bot/i, /bot token/i, /webhook/i],
		filePatterns: [/telegram/i],
		minimumScore: 0.45
	},
	{
		slug: 'portfolio-websites',
		name: 'Portfolio Websites',
		description: 'Personal portfolios, CV sites, and resume pages.',
		categories: ['portfolio', 'personal-website', 'portfolio-collection'],
		topicPatterns: ['resume', 'cv'],
		textPatterns: [
			/\b(personal|professional) portfolio (website|site|page)\b/i,
			/\bgraphic design portfolio\b/i,
			/\bpersonal (site|website)\b/i,
			/\bresume (website|site|page)\b/i
		],
		weakTextPatterns: [/\bportfolio\b/i],
		negativeTextPatterns: [
			/\bdata mining\b/i,
			/\bdataset\b/i,
			/\binterview simulator\b/i,
			/\bcompany profile\b/i,
			/\bportfolio lead\b/i,
			/\banalytics\b/i,
			/\bmachine learning\b/i
		],
		negativeTopicPatterns: ['dataset', 'machine-learning', 'data-mining'],
		requireStrongEvidence: true,
		minimumScore: 0.5
	},
	{
		slug: 'e-commerce-apps',
		name: 'E-commerce Apps',
		description: 'Online stores, checkout flows, and commerce platforms.',
		categories: ['product'],
		topicPatterns: ['ecommerce', 'e-commerce', 'shopify', 'woocommerce', 'stripe'],
		textPatterns: [/\be-?commerce\b/i, /online store/i, /shopping cart/i, /checkout flow/i],
		minimumScore: 0.45
	},
	{
		slug: 'hackathon-projects',
		name: 'Hackathon Projects',
		description: 'Hackathon submissions and weekend build experiments.',
		topicPatterns: ['hackathon', 'hackathon-project'],
		textPatterns: [/\bhackathon\b/i, /built in 24 hours/i, /weekend project/i],
		minimumScore: 0.4
	},
	{
		slug: 'github-classroom-assignments',
		name: 'GitHub Classroom Assignments',
		description: 'Coursework repos created through GitHub Classroom.',
		categories: ['school-assignment'],
		topicPatterns: ['github-classroom'],
		textPatterns: [/\bgithub classroom\b/i, /\bassignment\b/i, /\bcoursework\b/i],
		filePatterns: [/\.github\/classroom/i],
		minimumScore: 0.45
	},
	{
		slug: 'power-bi-dashboards',
		name: 'Power BI Dashboards',
		description: 'Power BI reports, dashboards, and analytics workbooks.',
		topicPatterns: ['powerbi', 'power-bi', 'dax'],
		textPatterns: [/\bpower bi\b/i, /\.pbix\b/i, /\bdax\b/i],
		filePatterns: [/\.pbix$/i, /power[- ]?bi/i],
		languagePatterns: ['DAX', 'M'],
		minimumScore: 0.45
	},
	{
		slug: 'roblox-projects',
		name: 'Roblox Projects',
		description: 'Roblox games, scripts, and Studio projects.',
		categories: ['game'],
		topicPatterns: ['roblox', 'roblox-studio'],
		textPatterns: [/\broblox\b/i, /roblox studio/i],
		filePatterns: [/\.rbxl/i, /roblox/i],
		minimumScore: 0.45
	},
	{
		slug: 'minecraft-mods',
		name: 'Minecraft Mods',
		description: 'Minecraft mods, plugins, and datapacks.',
		categories: ['game'],
		topicPatterns: ['minecraft', 'minecraft-mod', 'spigot', 'bukkit', 'fabricmc', 'forge'],
		textPatterns: [/\bminecraft\b/i, /spigot plugin/i, /fabric mod/i],
		filePatterns: [/minecraft/i, /plugin\.yml$/],
		minimumScore: 0.45
	},
	{
		slug: 'devops-templates',
		name: 'DevOps Templates',
		description: 'Infrastructure, CI/CD, and deployment starter templates.',
		categories: ['devops', 'spam-template'],
		topicPatterns: ['devops', 'terraform', 'kubernetes', 'helm', 'ansible', 'template'],
		textPatterns: [/\bdevops template\b/i, /terraform module/i, /helm chart/i, /ci\/cd template/i],
		filePatterns: [/dockerfile/i, /\.github\/workflows\//, /terraform/i, /helm/i],
		minimumScore: 0.4
	},
	{
		slug: 'security-tools',
		name: 'Security Tools',
		description: 'Security scanners, CTF tools, and offensive/defensive utilities.',
		categories: ['security', 'library', 'product'],
		topicPatterns: ['security', 'cybersecurity', 'pentest', 'ctf', 'vulnerability'],
		textPatterns: [/\bsecurity tool/i, /penetration test/i, /\bctf\b/i, /vulnerability scan/i],
		minimumScore: 0.45
	},
	{
		slug: 'cv-computer-vision',
		name: 'CV / Computer Vision',
		description: 'Computer vision models, pipelines, and demos.',
		categories: ['data-science', 'ai-project'],
		topicPatterns: [
			'computer-vision',
			'opencv',
			'yolo',
			'object-detection',
			'image-segmentation',
			'image-classification',
			'image-processing',
			'vision-transformer',
			'ocr',
			'bounding-box',
			'webcam',
			'detectron',
			'ultralytics',
			'mediapipe'
		],
		textPatterns: [
			/computer[- ]vision/i,
			/\bopencv\b/i,
			/\byolo\b/i,
			/object[- ]detection/i,
			/image[- ]classification/i,
			/image[- ]segmentation/i,
			/image[- ]processing/i,
			/vision[- ]transformer/i,
			/\bocr\b/i,
			/bounding[- ]box(es)?/i,
			/\bwebcam\b/i,
			/\bdetectron2?\b/i,
			/\bultralytics\b/i,
			/\bmediapipe\b/i,
			/semantic segmentation/i,
			/instance segmentation/i
		],
		// Generic AI/agent/model wording is supporting only — never sufficient alone.
		weakTextPatterns: [
			/\b(ai|ml|machine learning|deep learning|neural network|model|agent)\b/i
		],
		filePatterns: [
			/opencv/i,
			/yolo/i,
			/detectron/i,
			/ultralytics/i,
			/mediapipe/i,
			/vision_transformer/i,
			/object_detect/i
		],
		negativeTextPatterns: [
			/\bcrewai\b/i,
			/\blanggraph\b/i,
			/\blangchain\b/i,
			/text[- ]to[- ]sql/i,
			/\bsql agent\b/i,
			/\bai agent\b/i,
			/agent (framework|orchestr|workflow|template)/i,
			/multi[- ]agent/i,
			/\brag (pipeline|app|application)\b/i,
			/retrieval[- ]augmented/i,
			/llm orchestr/i,
			/chatbot framework/i
		],
		negativeTopicPatterns: [
			'crewai',
			'langgraph',
			'langchain',
			'text-to-sql',
			'rag',
			'ai-agent',
			'llm-agent',
			'autonomous-agent'
		],
		requireStrongEvidence: true,
		minimumScore: 0.5
	},
	{
		slug: 'trading-bots',
		name: 'Trading Bots',
		description: 'Crypto, forex, and stock trading automation.',
		categories: ['bot', 'application', 'product', 'ai-project'],
		topicPatterns: ['trading-bot', 'crypto-trading', 'algorithmic-trading', 'quant'],
		textPatterns: [/\btrading bot\b/i, /algorithmic trading/i, /crypto bot/i, /stock trading/i],
		weakTextPatterns: [/\btrading\b/i],
		requireStrongEvidence: true,
		minimumScore: 0.45
	},
	{
		slug: 'healthcare-ai',
		name: 'Healthcare AI',
		description: 'Medical imaging, clinical NLP, and health-focused ML.',
		categories: ['ai-project', 'data-science'],
		topicPatterns: ['healthcare', 'medical-ai', 'health-tech', 'bioinformatics'],
		textPatterns: [/\bhealthcare ai\b/i, /medical imaging/i, /clinical nlp/i, /patient data/i],
		minimumScore: 0.45
	},
	{
		slug: 'chat-applications',
		name: 'Chat Applications',
		description: 'Messaging apps, chat UIs, and realtime conversation tools.',
		categories: ['product', 'ai-project'],
		topicPatterns: ['chat', 'chat-app', 'messaging', 'websocket'],
		textPatterns: [/\bchat app/i, /real[- ]time chat/i, /messaging platform/i, /chat ui/i],
		minimumScore: 0.4
	},
	{
		slug: 'url-shorteners',
		name: 'URL Shorteners',
		description: 'Link shorteners and redirect services.',
		categories: ['product', 'library'],
		topicPatterns: ['url-shortener', 'link-shortener'],
		textPatterns: [/\burl shortener\b/i, /link shortener/i, /short link/i, /tinyurl/i],
		minimumScore: 0.45
	}
];

export function getClusterDefinition(slug: string): ClusterDefinition | undefined {
	return CLUSTER_DEFINITIONS.find((def) => def.slug === slug);
}

export function getClusterSlugs(): string[] {
	return CLUSTER_DEFINITIONS.map((def) => def.slug);
}

/** Most-specific clusters first — used as the final tie-breaker for story primary cluster. */
export const CLUSTER_STORY_PRIORITY: string[] = [
	'mcp-servers',
	'rag-applications',
	'llm-wrappers',
	'url-shorteners',
	'power-bi-dashboards',
	'roblox-projects',
	'minecraft-mods',
	'github-classroom-assignments',
	'trading-bots',
	'healthcare-ai',
	'cv-computer-vision',
	'discord-bots',
	'telegram-bots',
	'security-tools',
	'e-commerce-apps',
	'hackathon-projects',
	'portfolio-websites',
	'devops-templates',
	'chat-applications',
	'ai-agents'
];

export function clusterStoryPriorityIndex(slug: string): number {
	const index = CLUSTER_STORY_PRIORITY.indexOf(slug);
	return index === -1 ? CLUSTER_STORY_PRIORITY.length : index;
}
