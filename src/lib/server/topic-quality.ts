export interface TopicQualityInput {
	topic: string;
	count: number;
}

export interface TopicQualityEvaluation {
	topic: string;
	label: string;
	count: number;
	score: number;
	confidence: 'direct' | 'derived' | 'heuristic';
	accepted: boolean;
	reasons: string[];
}

const EDGE_STOP_WORDS = new Set([
	'a',
	'an',
	'and',
	'as',
	'by',
	'for',
	'from',
	'in',
	'into',
	'of',
	'on',
	'or',
	'that',
	'the',
	'to',
	'using',
	'with'
]);

const GENERIC_FRAGMENTS = new Set([
	'app',
	'application',
	'assistant',
	'build',
	'built',
	'created',
	'fast',
	'free',
	'generator',
	'management',
	'new',
	'project',
	'simple',
	'tool',
	'website'
]);

const TRUSTED_TERMS = new Set([
	'ai',
	'api',
	'auth',
	'authentication',
	'bun',
	'cli',
	'cloudflare',
	'css',
	'devops',
	'docker',
	'electron',
	'evaluation',
	'fastapi',
	'gemini',
	'github',
	'google',
	'html',
	'jwt',
	'kubernetes',
	'langchain',
	'langgraph',
	'llm',
	'mcp',
	'multimodal',
	'next',
	'node',
	'ollama',
	'prisma',
	'python',
	'rag',
	'react',
	'security',
	'sqlite',
	'streamlit',
	'svelte',
	'sveltekit',
	'tailwind',
	'typescript',
	'vite',
	'vue'
]);

const SPECIAL_LABELS = new Map<string, string>([
	['ai', 'AI'],
	['api', 'API'],
	['ci', 'CI'],
	['cli', 'CLI'],
	['css', 'CSS'],
	['html', 'HTML'],
	['jwt', 'JWT'],
	['llm', 'LLM'],
	['mcp', 'MCP'],
	['rag', 'RAG'],
	['ui', 'UI']
]);

function wordsFor(topic: string): string[] {
	return topic
		.toLowerCase()
		.replace(/[_./]+/g, '-')
		.split(/[-\s]+/)
		.map((word) => word.trim())
		.filter(Boolean);
}

function formatTopicLabel(words: string[]): string {
	return words
		.map((word) => SPECIAL_LABELS.get(word) ?? `${word[0].toUpperCase()}${word.slice(1)}`)
		.join(' ');
}

export function evaluateTopicQuality(input: TopicQualityInput): TopicQualityEvaluation {
	const words = wordsFor(input.topic);
	const reasons: string[] = [];
	let score = Math.min(70, Math.max(12, input.count * 14));

	if (words.length === 0) reasons.push('empty');
	if (words.length > 4) reasons.push('too_many_words');
	if (words[0] && EDGE_STOP_WORDS.has(words[0])) reasons.push('starts_with_stop_word');
	if (words.at(-1) && EDGE_STOP_WORDS.has(words.at(-1)!)) reasons.push('ends_with_stop_word');
	if (words.length >= 2 && new Set(words).size !== words.length) reasons.push('duplicate_token');

	const trustedCount = words.filter((word) => TRUSTED_TERMS.has(word)).length;
	const genericCount = words.filter((word) => GENERIC_FRAGMENTS.has(word)).length;
	const hasRecognizedEntity = trustedCount > 0;

	if (!hasRecognizedEntity && input.count < 3) reasons.push('no_recognized_entity');
	if (genericCount === words.length && words.length > 0) reasons.push('generic_fragment');
	if (words.length >= 2 && genericCount > 0 && trustedCount === 0) reasons.push('generic_phrase');

	score += trustedCount * 18;
	score -= genericCount * 10;
	score -= reasons.length * 24;
	score = Math.max(0, Math.min(100, score));

	return {
		topic: input.topic,
		label: formatTopicLabel(words),
		count: input.count,
		score,
		confidence: hasRecognizedEntity ? 'direct' : 'heuristic',
		accepted: reasons.length === 0 && score >= 45,
		reasons
	};
}

export function filterVerifiedTopics(topics: TopicQualityInput[], limit = 16): TopicQualityEvaluation[] {
	return topics
		.map(evaluateTopicQuality)
		.filter((topic) => topic.accepted)
		.sort((a, b) => b.count - a.count || b.score - a.score || a.label.localeCompare(b.label))
		.slice(0, limit);
}
