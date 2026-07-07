export interface SummarizeRepoInput {
	description: string | null;
	language: string | null;
	topics: string[];
	readmeExcerpt?: string | null;
}

const MAX_SUMMARY = 280;

export function summarizeRepo(input: SummarizeRepoInput): string {
	const topicHint =
		input.topics.length > 0 ? ` Topics: ${input.topics.slice(0, 4).join(', ')}.` : '';
	const langHint = input.language ? ` Written in ${input.language}.` : '';

	if (input.readmeExcerpt?.trim()) {
		const firstLine = input.readmeExcerpt
			.split('\n')
			.map((l) => l.replace(/^#+\s*/, '').trim())
			.find((l) => l.length > 10);
		if (firstLine) {
			return truncate(`${firstLine}${langHint}${topicHint}`, MAX_SUMMARY);
		}
	}

	if (input.description?.trim()) {
		return truncate(`${input.description.trim()}${langHint}${topicHint}`, MAX_SUMMARY);
	}

	const parts = ['GitHub repository'];
	if (input.language) parts.push(`primarily using ${input.language}`);
	if (input.topics.length > 0) parts.push(`tagged with ${input.topics.slice(0, 3).join(', ')}`);
	return truncate(parts.join(', ') + '.', MAX_SUMMARY);
}

function truncate(text: string, max: number): string {
	const cleaned = text.replace(/\s+/g, ' ').trim();
	if (cleaned.length <= max) return cleaned;
	return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}
