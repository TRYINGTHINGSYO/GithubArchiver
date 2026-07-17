import { normalizeCategory } from '$lib/server/classify-repo';
import {
	CLUSTER_DEFINITIONS,
	type ClusterDefinition
} from '$lib/server/cluster-registry';

export interface ClusterMatchEvidence {
	topics?: string[];
	nameMatches?: string[];
	readmeMatches?: string[];
	textMatches?: string[];
	files?: string[];
	languages?: string[];
	scoreBreakdown: {
		topics: number;
		name: number;
		readme: number;
		files: number;
		language: number;
	};
}

export interface ClusterRepoInput {
	owner: string;
	name: string;
	full_name: string;
	description: string | null;
	language: string | null;
	topics: string[];
	category: string | null;
	readmeExcerpt?: string | null;
	filePaths?: string[];
}

export interface ClusterMatchResult {
	slug: string;
	confidence: number;
	evidence: ClusterMatchEvidence;
}

const TOPIC_WEIGHT = 50;
const NAME_WEIGHT = 25;
const README_WEIGHT = 15;
const FILE_WEIGHT = 10;

function categoryAllowed(def: ClusterDefinition, category: string | null): boolean {
	if (!def.categories?.length) return true;
	if (!category) return false;
	const normalized = normalizeCategory(category);
	if (!normalized) return false;
	return def.categories.includes(normalized);
}

function scoreTopics(def: ClusterDefinition, topics: string[]): { score: number; matched: string[] } {
	if (!def.topicPatterns?.length || topics.length === 0) return { score: 0, matched: [] };
	const matched: string[] = [];
	for (const topic of topics) {
		for (const pattern of def.topicPatterns) {
			if (topic.includes(pattern) || pattern.includes(topic)) {
				matched.push(topic);
				break;
			}
		}
	}
	if (matched.length === 0) return { score: 0, matched: [] };
	const strength = matched.length >= 2 ? 1 : 0.75;
	return { score: Math.round(TOPIC_WEIGHT * strength), matched: [...new Set(matched)] };
}

function scoreName(def: ClusterDefinition, name: string, fullName: string): { score: number; matched: string[] } {
	const haystack = `${name} ${fullName}`.toLowerCase();
	const matched: string[] = [];

	for (const pattern of def.topicPatterns ?? []) {
		if (haystack.includes(pattern)) matched.push(pattern);
	}
	for (const re of def.textPatterns ?? []) {
		if (re.test(haystack)) matched.push(re.source);
	}

	if (matched.length === 0) return { score: 0, matched: [] };
	const strength = matched.length >= 2 ? 1 : 0.7;
	return { score: Math.round(NAME_WEIGHT * strength), matched: [...new Set(matched)] };
}

function scoreReadme(
	def: ClusterDefinition,
	description: string | null,
	readmeExcerpt: string | null | undefined
): { score: number; matched: string[] } {
	const text = `${description ?? ''}\n${readmeExcerpt ?? ''}`.trim();
	if (!text || !def.textPatterns?.length) return { score: 0, matched: [] };

	const matched: string[] = [];
	for (const re of def.textPatterns) {
		if (re.test(text)) matched.push(re.source);
	}

	if (matched.length === 0) return { score: 0, matched: [] };
	const strength = matched.length >= 2 ? 1 : 0.7;
	return { score: Math.round(README_WEIGHT * strength), matched: [...new Set(matched)] };
}

function scoreFiles(def: ClusterDefinition, filePaths: string[]): { score: number; matched: string[] } {
	if (!def.filePatterns?.length || filePaths.length === 0) return { score: 0, matched: [] };
	const matched: string[] = [];
	for (const path of filePaths) {
		for (const re of def.filePatterns) {
			if (re.test(path)) {
				matched.push(path);
				break;
			}
		}
	}
	if (matched.length === 0) return { score: 0, matched: [] };
	const strength = matched.length >= 2 ? 1 : 0.75;
	return { score: Math.round(FILE_WEIGHT * strength), matched: matched.slice(0, 5) };
}

function scoreLanguage(def: ClusterDefinition, language: string | null): { score: number; matched: string[] } {
	if (!def.languagePatterns?.length || !language) return { score: 0, matched: [] };
	const matched = def.languagePatterns.filter((lang) => lang.toLowerCase() === language.toLowerCase());
	if (matched.length === 0) return { score: 0, matched: [] };
	return { score: FILE_WEIGHT, matched };
}

export function matchCluster(def: ClusterDefinition, input: ClusterRepoInput): ClusterMatchResult | null {
	if (!categoryAllowed(def, input.category)) return null;

	const topics = scoreTopics(def, input.topics.map((t) => t.toLowerCase()));
	const name = scoreName(def, input.name.toLowerCase(), input.full_name.toLowerCase());
	const readme = scoreReadme(def, input.description, input.readmeExcerpt);
	const files = scoreFiles(def, (input.filePaths ?? []).map((p) => p.toLowerCase()));
	const language = scoreLanguage(def, input.language);

	const rawScore = topics.score + name.score + readme.score + files.score + language.score;
	if (rawScore === 0) return null;

	const strongest = Math.max(
		topics.score / TOPIC_WEIGHT,
		name.score / NAME_WEIGHT,
		readme.score / README_WEIGHT,
		files.score / FILE_WEIGHT,
		language.score / FILE_WEIGHT
	);
	const confidence =
		Math.round(Math.min(1, strongest * 0.55 + (rawScore / 100) * 0.45) * 1000) / 1000;
	if (confidence < def.minimumScore) return null;

	const evidence: ClusterMatchEvidence = {
		scoreBreakdown: {
			topics: topics.score,
			name: name.score,
			readme: readme.score,
			files: files.score,
			language: language.score
		}
	};
	if (topics.matched.length) evidence.topics = topics.matched;
	if (name.matched.length) evidence.nameMatches = name.matched;
	if (readme.matched.length) evidence.readmeMatches = readme.matched;
	if (files.matched.length) evidence.files = files.matched;
	if (language.matched.length) evidence.languages = language.matched;

	return { slug: def.slug, confidence, evidence };
}

export function clusterRepo(input: ClusterRepoInput): ClusterMatchResult[] {
	const matches: ClusterMatchResult[] = [];
	for (const def of CLUSTER_DEFINITIONS) {
		const result = matchCluster(def, input);
		if (result) matches.push(result);
	}
	return matches.sort((a, b) => b.confidence - a.confidence);
}

export function clusterRepoSlugs(input: ClusterRepoInput): string[] {
	return clusterRepo(input).map((match) => match.slug);
}
