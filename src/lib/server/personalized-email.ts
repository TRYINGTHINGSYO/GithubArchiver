import { randomUUID } from 'node:crypto';
import { getDb } from './db/connection';
import {
	getUserEmailPreference,
	listEnabledEmailDigestUsers,
	markUserDigestSent,
	type EmailDigestUser
} from './db/email-preferences';

export interface InterestSeed {
	id: number;
	language: string | null;
	topics: string[];
	clusters: string[];
}

export interface RecommendationCandidate {
	id: number;
	owner: string;
	name: string;
	fullName: string;
	description: string | null;
	language: string | null;
	topics: string[];
	clusters: string[];
	interestingScore: number;
	stars: number;
	firstSeenAt: string;
}

export interface RankedRecommendation extends RecommendationCandidate {
	matchScore: number;
	reasons: string[];
}

export interface PersonalizedDigestResult {
	configured: boolean;
	usersConsidered: number;
	usersEmailed: number;
	recommendationsSent: number;
	skippedWithoutInterests: number;
	skippedWithoutMatches: number;
	errors: string[];
}

interface RepoInterestRow {
	id: number;
	owner: string;
	name: string;
	full_name: string;
	description: string | null;
	language: string | null;
	topics: string | null;
	clusters: string | null;
	interesting_score: number | null;
	stars: number | null;
	first_seen_at: string;
}

interface EmailMessage {
	to: string;
	subject: string;
	html: string;
	text: string;
}

function stringList(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		if (Array.isArray(parsed)) {
			return parsed.filter((item): item is string => typeof item === 'string');
		}
	} catch {
		// GROUP_CONCAT cluster lists are comma-separated, not JSON.
	}
	return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function unique(values: string[]): string[] {
	return [...new Set(values.map(normalize).filter(Boolean))];
}

export function rankPersonalizedRecommendations(
	seeds: InterestSeed[],
	candidates: RecommendationCandidate[],
	limit = 5
): RankedRecommendation[] {
	const languages = new Set(unique(seeds.flatMap((seed) => (seed.language ? [seed.language] : []))));
	const topics = new Set(unique(seeds.flatMap((seed) => seed.topics)));
	const clusters = new Set(unique(seeds.flatMap((seed) => seed.clusters)));

	return candidates
		.map((candidate): RankedRecommendation | null => {
			const reasons: string[] = [];
			let matchScore = candidate.interestingScore * 0.45;
			const language = candidate.language ? normalize(candidate.language) : null;
			if (language && languages.has(language)) {
				matchScore += 24;
				reasons.push(`${candidate.language} matches your saved projects`);
			}

			const sharedTopics = unique(candidate.topics).filter((topic) => topics.has(topic)).slice(0, 3);
			if (sharedTopics.length > 0) {
				matchScore += sharedTopics.length * 14;
				reasons.push(`shared topics: ${sharedTopics.join(', ')}`);
			}

			const sharedClusters = unique(candidate.clusters)
				.filter((cluster) => clusters.has(cluster))
				.slice(0, 2);
			if (sharedClusters.length > 0) {
				matchScore += sharedClusters.length * 18;
				reasons.push(`related area: ${sharedClusters.join(', ')}`);
			}

			if (reasons.length === 0) return null;
			return { ...candidate, matchScore, reasons };
		})
		.filter((candidate): candidate is RankedRecommendation => candidate !== null)
		.sort(
			(a, b) =>
				b.matchScore - a.matchScore ||
				b.interestingScore - a.interestingScore ||
				b.firstSeenAt.localeCompare(a.firstSeenAt)
		)
		.slice(0, Math.max(1, limit));
}

function seedsForUser(userId: string): InterestSeed[] {
	const rows = getDb()
		.prepare(
			`SELECT r.id, r.language, r.topics,
			        GROUP_CONCAT(DISTINCT c.slug) AS clusters
			 FROM user_saved_repos s
			 JOIN repos r ON r.id = s.repo_id
			 LEFT JOIN repository_cluster_memberships m ON m.repository_id = r.id
			 LEFT JOIN repo_clusters c ON c.id = m.cluster_id
			 WHERE s.user_id = ?
			 GROUP BY r.id, r.language, r.topics`
		)
		.all(userId) as Array<Pick<RepoInterestRow, 'id' | 'language' | 'topics' | 'clusters'>>;
	return rows.map((row) => ({
		id: row.id,
		language: row.language,
		topics: stringList(row.topics),
		clusters: stringList(row.clusters)
	}));
}

function candidatesForUser(user: EmailDigestUser, lookbackDays: number): RecommendationCandidate[] {
	const lookback = `-${Math.max(1, Math.trunc(lookbackDays))} days`;
	const rows = getDb()
		.prepare(
			`SELECT r.id, r.owner, r.name, r.full_name, r.description, r.language, r.topics,
			        GROUP_CONCAT(DISTINCT c.slug) AS clusters,
			        r.interesting_score, COALESCE(r.stars, 0) AS stars, r.first_seen_at
			 FROM repos r
			 LEFT JOIN repository_cluster_memberships m ON m.repository_id = r.id
			 LEFT JOIN repo_clusters c ON c.id = m.cluster_id
			 WHERE r.deleted_at IS NULL
			   AND r.pending_deletion_at IS NULL
			   AND r.enriched_at IS NOT NULL
			   AND r.first_seen_at >= datetime('now', ?)
			   AND COALESCE(r.interesting_score, 0) >= ?
			   AND NOT EXISTS (
			     SELECT 1 FROM user_saved_repos s WHERE s.user_id = ? AND s.repo_id = r.id
			   )
			   AND NOT EXISTS (
			     SELECT 1 FROM personalized_email_deliveries d
			     WHERE d.user_id = ? AND d.repo_id = r.id
			   )
			 GROUP BY r.id
			 ORDER BY r.interesting_score DESC, r.first_seen_at DESC
			 LIMIT 1000`
		)
		.all(lookback, user.minimumScore, user.id, user.id) as RepoInterestRow[];

	return rows.map((row) => ({
		id: row.id,
		owner: row.owner,
		name: row.name,
		fullName: row.full_name,
		description: row.description,
		language: row.language,
		topics: stringList(row.topics),
		clusters: stringList(row.clusters),
		interestingScore: row.interesting_score ?? 0,
		stars: row.stars ?? 0,
		firstSeenAt: row.first_seen_at
	}));
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

function appOrigin(): string {
	return (process.env.PUBLIC_APP_URL ?? process.env.ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '');
}

export function renderPersonalizedDigest(
	user: Pick<EmailDigestUser, 'name' | 'email'>,
	recommendations: RankedRecommendation[]
): EmailMessage {
	const origin = appOrigin();
	const greeting = user.name?.trim() ? `Hi ${user.name.trim()},` : 'Hi,';
	const subject = `${recommendations.length} new GitHub ${recommendations.length === 1 ? 'project' : 'projects'} matched your interests`;
	const items = recommendations
		.map((repo) => {
			const url = `${origin}/repo/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
			const description = repo.description ?? 'A newly discovered repository worth a closer look.';
			return `<li style="margin:0 0 22px"><a href="${url}" style="font-size:17px;font-weight:700;color:#2388ff">${escapeHtml(repo.fullName)}</a><p style="margin:6px 0;color:#334155">${escapeHtml(description)}</p><p style="margin:4px 0;color:#64748b;font-size:13px">${escapeHtml(repo.reasons.join(' · '))} · Interest score ${Math.round(repo.interestingScore)}</p></li>`;
		})
		.join('');
	const textItems = recommendations
		.map(
			(repo) =>
				`- ${repo.fullName}: ${repo.description ?? 'Newly discovered repository'}\n  Why: ${repo.reasons.join('; ')}\n  ${origin}/repo/${repo.owner}/${repo.name}`
		)
		.join('\n\n');
	const settingsUrl = `${origin}/account/notifications`;
	return {
		to: user.email,
		subject,
		html: `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,sans-serif;color:#0f172a"><main style="max-width:620px;margin:0 auto;padding:32px 22px"><p>${escapeHtml(greeting)}</p><h1 style="font-size:24px">New repositories selected for you</h1><p style="color:#475569">These projects were newly discovered and overlap with languages, topics, or categories in repositories you saved.</p><ol style="padding-left:22px">${items}</ol><p style="margin-top:30px;color:#64748b;font-size:12px">You enabled personalized discovery emails in GithubArchive+. <a href="${settingsUrl}">Manage or turn off emails</a>.</p></main></body></html>`,
		text: `${greeting}\n\nNew repositories selected for you\n\n${textItems}\n\nManage or turn off emails: ${settingsUrl}`
	};
}

export function personalizedEmailConfigured(): boolean {
	return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export async function sendPersonalizedEmail(
	message: EmailMessage,
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	const apiKey = process.env.RESEND_API_KEY?.trim();
	const from = process.env.EMAIL_FROM?.trim();
	if (!apiKey || !from) throw new Error('Personalized email is not configured');

	const response = await fetchImpl('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${apiKey}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text })
	});
	const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
	if (!response.ok) {
		throw new Error(body?.message ?? `Email provider returned HTTP ${response.status}`);
	}
	return body?.id ?? null;
}

export async function runPersonalizedEmailDigest(): Promise<PersonalizedDigestResult> {
	const result: PersonalizedDigestResult = {
		configured: personalizedEmailConfigured(),
		usersConsidered: 0,
		usersEmailed: 0,
		recommendationsSent: 0,
		skippedWithoutInterests: 0,
		skippedWithoutMatches: 0,
		errors: []
	};
	if (!result.configured) return result;

	const lookbackDays = Number(process.env.EMAIL_DIGEST_LOOKBACK_DAYS ?? 7);
	const configuredMax = Number(process.env.EMAIL_DIGEST_MAX_REPOS ?? 5);
	const maxRecommendations = Number.isFinite(configuredMax)
		? Math.max(1, Math.min(10, Math.trunc(configuredMax)))
		: 5;
	const users = listEnabledEmailDigestUsers();
	result.usersConsidered = users.length;

	for (const user of users) {
		try {
			const seeds = seedsForUser(user.id);
			if (seeds.length === 0) {
				result.skippedWithoutInterests++;
				continue;
			}
			const matches = rankPersonalizedRecommendations(
				seeds,
				candidatesForUser(user, Number.isFinite(lookbackDays) ? lookbackDays : 7),
				maxRecommendations
			);
			if (matches.length === 0) {
				result.skippedWithoutMatches++;
				continue;
			}
			// Honor an opt-out that happened after this batch loaded its initial user list.
			if (!getUserEmailPreference(user.id).enabled) continue;
			const message = renderPersonalizedDigest(user, matches);
			const providerMessageId = await sendPersonalizedEmail(message);
			markUserDigestSent(
				user.id,
				matches.map((match) => match.id),
				`${new Date().toISOString().slice(0, 10)}:${randomUUID()}`,
				providerMessageId
			);
			result.usersEmailed++;
			result.recommendationsSent += matches.length;
		} catch (error) {
			result.errors.push(
				`${user.id}: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	return result;
}
