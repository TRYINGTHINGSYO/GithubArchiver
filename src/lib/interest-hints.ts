const AI_TOPIC_RE = /\b(ai|llm|agent|mcp|ml|machine-learning|openai|gpt|claude)\b/i;

export interface InterestHintInput {
	moment_tag?: string;
	velocity?: 'up' | 'down' | 'flat';
	stars?: number | null;
	has_readme?: boolean;
	has_release?: boolean;
	topics?: string[];
	license?: string | null;
	deleted_at?: string | null;
}

export function buildInterestHints(repo: InterestHintInput, max = 3): string[] {
	const hints: string[] = [];

	if (repo.moment_tag === 'just discovered') hints.push('Just discovered by the archive');
	if (repo.moment_tag === 'revived') hints.push('Recently active after a long quiet period');
	if (repo.velocity === 'up') hints.push('Showing upward activity signals');
	if (repo.has_release) hints.push('Has published releases');
	if (repo.has_readme) hints.push('README archived locally');
	if (repo.topics?.some((t) => AI_TOPIC_RE.test(t))) hints.push('AI-related topics');
	if (repo.stars != null && repo.stars >= 100) hints.push(`${repo.stars.toLocaleString()} stars`);
	if (repo.deleted_at) hints.push('Recently deleted on GitHub');

	return hints.slice(0, max);
}
