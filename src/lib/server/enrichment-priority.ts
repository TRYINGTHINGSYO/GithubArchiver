import { CLUSTER_DEFINITIONS } from '$lib/server/cluster-registry';
import type { RepoRow } from '$lib/server/db/types';

export type EnrichmentTier = 'urgent' | 'high' | 'normal' | 'low' | 'deferred';
export type EnrichmentStatus =
	| 'pending'
	| 'claimed'
	| 'done'
	| 'retry'
	| 'deferred'
	| 'unavailable'
	| 'forbidden'
	| 'terminal';
export type EnrichmentDepth = 'none' | 'fast' | 'deep';

const HIGH_VALUE_KEYWORDS =
	/\b(mcp|llm|rag|agent|ai|openai|claude|langchain|kubernetes|rust|typescript|sdk|framework|library|api)\b/i;
const SPAMMY_KEYWORDS =
	/\b(assignment|homework|lab\d+|coursework|my-first|hello-world|test-repo|untitled)\b/i;

export interface PriorityInput {
	stars?: number | null;
	forks?: number | null;
	created_at: string;
	first_seen_at?: string | null;
	pushed_at?: string | null;
	description?: string | null;
	language?: string | null;
	topics?: string | null;
	owner?: string | null;
	name?: string | null;
	full_name?: string | null;
	enrichment_attempts?: number | null;
	last_enrichment_error?: string | null;
	event_count?: number | null;
}

export interface PriorityResult {
	priority: number;
	tier: EnrichmentTier;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ageDays(iso: string | null | undefined): number {
	if (!iso) return 9999;
	const ms = Date.now() - Date.parse(iso);
	if (!Number.isFinite(ms) || ms < 0) return 9999;
	return ms / 86_400_000;
}

function descriptionQuality(description: string | null | undefined): number {
	if (!description) return 0;
	const trimmed = description.trim();
	if (trimmed.length < 8) return 2;
	if (trimmed.length < 20) return 8;
	if (trimmed.length < 80) return 15;
	return 22;
}

function topicsScore(topics: string | null | undefined): number {
	if (!topics || topics === '[]' || topics === '') return 0;
	try {
		const parsed = JSON.parse(topics) as unknown;
		if (Array.isArray(parsed) && parsed.length > 0) return Math.min(18, 6 + parsed.length * 3);
	} catch {
		if (topics.includes(',')) return 10;
	}
	return 4;
}

function clusterHintScore(input: PriorityInput): number {
	const hay = `${input.full_name ?? ''} ${input.description ?? ''} ${input.topics ?? ''}`.toLowerCase();
	let score = 0;
	for (const cluster of CLUSTER_DEFINITIONS) {
		for (const topic of cluster.topicPatterns ?? []) {
			// Word-boundary match — plain includes("rag") falsely hits "storage"/"average".
			const re = new RegExp(`\\b${escapeRegExp(topic.toLowerCase())}\\b`, 'i');
			if (re.test(hay)) {
				score = Math.max(score, 35);
			}
		}
		for (const pattern of cluster.textPatterns ?? []) {
			if (pattern.test(hay)) score = Math.max(score, 30);
		}
	}
	return score;
}

function spamPenalty(input: PriorityInput): number {
	const hay = `${input.full_name ?? ''} ${input.description ?? ''}`;
	if (SPAMMY_KEYWORDS.test(hay)) return -40;
	if (/^\d+$/.test(input.name ?? '')) return -25;
	return 0;
}

function hasHighValueSignal(input: PriorityInput, clusterScore: number): boolean {
	if (clusterScore >= 30) return true;
	const hay = `${input.full_name ?? ''} ${input.description ?? ''} ${input.topics ?? ''}`;
	return HIGH_VALUE_KEYWORDS.test(hay);
}

/**
 * Tier rules (deliberately NOT "every CreateEvent is urgent"):
 * - urgent: clear demand (stars) or strong signal on a brand-new repo
 * - high: worth enriching soon (recent, modest stars, or newly discovered)
 * - normal / low / deferred: long-tail backlog
 */
export function assignEnrichmentTier(input: {
	priority: number;
	stars: number;
	createdAgeDays: number;
	seenAgeDays: number;
	hasSignal: boolean;
}): EnrichmentTier {
	const { priority, stars, createdAgeDays, seenAgeDays, hasSignal } = input;

	if (stars >= 50 || priority >= 160) return 'urgent';
	if (createdAgeDays <= 3 && (stars >= 5 || (hasSignal && priority >= 110))) return 'urgent';

	if (stars >= 10 || priority >= 100) return 'high';
	if (createdAgeDays <= 14 || seenAgeDays <= 2) return 'high';

	if (createdAgeDays > 400 && stars === 0 && priority < 40) return 'deferred';
	if (priority < 25 || (createdAgeDays > 365 && stars === 0)) return 'deferred';
	if (priority < 45 || (createdAgeDays > 180 && stars < 2)) return 'low';

	return 'normal';
}

export function scoreEnrichmentPriority(input: PriorityInput): PriorityResult {
	const stars = input.stars ?? 0;
	const forks = input.forks ?? 0;
	const createdAge = ageDays(input.created_at);
	const seenAge = ageDays(input.first_seen_at ?? input.created_at);
	const pushAge = ageDays(input.pushed_at);
	const attempts = input.enrichment_attempts ?? 0;
	const clusterScore = clusterHintScore(input);
	const keywordHit = HIGH_VALUE_KEYWORDS.test(
		`${input.full_name ?? ''} ${input.description ?? ''} ${input.topics ?? ''}`
	);
	const signal = hasHighValueSignal(input, clusterScore) || keywordHit;

	let priority =
		Math.log10(stars + 1) * 40 +
		Math.log10(forks + 1) * 12 +
		descriptionQuality(input.description) +
		topicsScore(input.topics) +
		(input.language ? 10 : 0) +
		clusterScore +
		(keywordHit ? 25 : 0) +
		spamPenalty(input) +
		Math.min(40, (input.event_count ?? 0) * 4);

	if (createdAge <= 3) priority += 55;
	else if (createdAge <= 14) priority += 35;
	else if (createdAge <= 45) priority += 20;
	else if (createdAge > 365) priority -= 20;

	if (seenAge <= 1) priority += 20;
	if (pushAge <= 14) priority += 15;
	if (attempts > 0) priority -= Math.min(50, attempts * 12);
	if (input.last_enrichment_error) priority -= 8;

	priority = Math.round(priority * 10) / 10;

	const tier = assignEnrichmentTier({
		priority,
		stars,
		createdAgeDays: createdAge,
		seenAgeDays: seenAge,
		hasSignal: signal
	});

	return { priority, tier };
}

export function scoreRepoEnrichmentPriority(repo: RepoRow, eventCount = 0): PriorityResult {
	return scoreEnrichmentPriority({
		stars: repo.stars,
		forks: repo.forks,
		created_at: repo.created_at,
		first_seen_at: repo.first_seen_at,
		pushed_at: repo.pushed_at,
		description: repo.description,
		language: repo.language,
		topics: repo.topics,
		owner: repo.owner,
		name: repo.name,
		full_name: repo.full_name,
		enrichment_attempts: (repo as RepoRow & { enrichment_attempts?: number }).enrichment_attempts,
		last_enrichment_error: (repo as RepoRow & { last_enrichment_error?: string | null })
			.last_enrichment_error,
		event_count: eventCount
	});
}

export function shouldDeepEnrich(input: {
	priority: number;
	tier: EnrichmentTier;
	interestingScore?: number | null;
	signalTier?: string | null;
	clustered?: boolean;
}): boolean {
	if (input.tier === 'urgent' || input.tier === 'high') return true;
	if ((input.interestingScore ?? 0) >= 55) return true;
	if (input.signalTier === 'high') return true;
	if (input.clustered && (input.interestingScore ?? 0) >= 40) return true;
	return input.priority >= 120;
}

export const TIER_ORDER: EnrichmentTier[] = ['urgent', 'high', 'normal', 'low', 'deferred'];
