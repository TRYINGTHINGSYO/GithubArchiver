import {
	SEMANTIC_DOCUMENT_MAX_CHARS,
	SEMANTIC_DOCUMENT_VERSION,
	SEMANTIC_README_MAX_CHARS
} from './constants.js';
import type { SemanticEntityType } from './ids.js';

export interface SemanticDocumentInput {
	entityType: SemanticEntityType;
	entityKey: string;
	name?: string | null;
	fullName?: string | null;
	description?: string | null;
	summary?: string | null;
	language?: string | null;
	topics?: string[] | string | null;
	category?: string | null;
	homepage?: string | null;
	readmeText?: string | null;
	pageTitle?: string | null;
	extraLines?: string[];
}

function parseTopics(topics: string[] | string | null | undefined): string[] {
	if (!topics) return [];
	if (Array.isArray(topics)) {
		return topics.map((t) => String(t).trim()).filter(Boolean);
	}
	try {
		const parsed = JSON.parse(topics) as unknown;
		if (Array.isArray(parsed)) {
			return parsed.map((t) => String(t).trim()).filter(Boolean);
		}
	} catch {
		/* treat as comma/space separated */
	}
	return topics
		.split(/[,|\s]+/)
		.map((t) => t.trim())
		.filter(Boolean);
}

/** Strip badges, HTML, URLs, and collapse whitespace for embedding text. */
export function sanitizeSemanticText(raw: string | null | undefined): string {
	if (!raw) return '';
	let text = raw;
	text = text.replace(/!\[[^\]]*]\([^)]*\)/g, ' ');
	text = text.replace(/\[[^\]]*]\([^)]*\)/g, ' ');
	text = text.replace(/https?:\/\/\S+/gi, ' ');
	text = text.replace(/<[^>]+>/g, ' ');
	text = text.replace(/```[\s\S]*?```/g, ' ');
	text = text.replace(/`[^`]*`/g, ' ');
	text = text.replace(/^\|.*\|$/gm, ' ');
	text = text.replace(/^#{1,6}\s+/gm, '');
	text = text.replace(/[^\S\n]+/g, ' ');
	text = text.replace(/\n{3,}/g, '\n\n');
	return text.trim();
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max).trimEnd();
}

function extractReadmeSignal(readme: string | null | undefined): string {
	const cleaned = sanitizeSemanticText(readme);
	if (!cleaned) return '';
	const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
	const kept: string[] = [];
	for (const line of lines) {
		const lower = line.toLowerCase();
		if (lower.startsWith('license')) continue;
		if (lower.startsWith('copyright')) continue;
		if (lower.includes('npm install') && line.length < 80) continue;
		if (lower.includes('pip install') && line.length < 80) continue;
		if (/^[-*]?\s*\[.*(badge|build|coverage|ci)].*$/i.test(line)) continue;
		kept.push(line);
		if (kept.join(' ').length >= SEMANTIC_README_MAX_CHARS) break;
	}
	return truncate(kept.join('\n'), SEMANTIC_README_MAX_CHARS);
}

/**
 * Deterministic semantic document used for fingerprinting and embedding.
 * Keep this pure: same input → same output across processes.
 */
export function buildSemanticDocument(input: SemanticDocumentInput): string {
	const topics = parseTopics(input.topics);
	const lines: string[] = [
		`semantic_document_version: ${SEMANTIC_DOCUMENT_VERSION}`,
		`entity_type: ${input.entityType}`,
		`entity_key: ${input.entityKey}`
	];

	const name = sanitizeSemanticText(input.name ?? input.fullName);
	if (name) lines.push(`Name: ${name}`);
	if (input.fullName && input.fullName !== name) {
		lines.push(`Full name: ${sanitizeSemanticText(input.fullName)}`);
	}
	const description = sanitizeSemanticText(input.description);
	if (description) lines.push(`Description: ${truncate(description, 500)}`);
	const summary = sanitizeSemanticText(input.summary);
	if (summary && summary !== description) {
		lines.push(`Summary: ${truncate(summary, 500)}`);
	}
	if (input.language) lines.push(`Primary language: ${sanitizeSemanticText(input.language)}`);
	if (topics.length) lines.push(`Topics: ${topics.join(', ')}`);
	if (input.category) lines.push(`Classification: ${sanitizeSemanticText(input.category)}`);
	if (input.homepage) lines.push(`Homepage: ${sanitizeSemanticText(input.homepage)}`);
	if (input.pageTitle) lines.push(`Page title: ${sanitizeSemanticText(input.pageTitle)}`);

	const readme = extractReadmeSignal(input.readmeText);
	if (readme) lines.push(`README:\n${readme}`);

	for (const extra of input.extraLines ?? []) {
		const cleaned = sanitizeSemanticText(extra);
		if (cleaned) lines.push(cleaned);
	}

	return truncate(lines.join('\n'), SEMANTIC_DOCUMENT_MAX_CHARS);
}

export function buildRepositorySemanticDocument(repo: {
	id: number;
	name?: string | null;
	full_name?: string | null;
	description?: string | null;
	summary?: string | null;
	language?: string | null;
	topics?: string[] | string | null;
	category?: string | null;
	homepage?: string | null;
	readmeText?: string | null;
}): string {
	return buildSemanticDocument({
		entityType: 'repository',
		entityKey: String(repo.id),
		name: repo.name,
		fullName: repo.full_name,
		description: repo.description,
		summary: repo.summary,
		language: repo.language,
		topics: repo.topics,
		category: repo.category,
		homepage: repo.homepage,
		readmeText: repo.readmeText
	});
}
