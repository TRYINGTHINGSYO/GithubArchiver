import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getUserEmailPreference,
	listEnabledEmailDigestUsers,
	markUserDigestSent,
	updateUserEmailPreference
} from '$lib/server/db/email-preferences';
import { getDb } from '$lib/server/db/connection';
import {
	rankPersonalizedRecommendations,
	renderPersonalizedDigest,
	runPersonalizedEmailDigest,
	sendPersonalizedEmail,
	type InterestSeed,
	type RecommendationCandidate
} from '$lib/server/personalized-email';
import { createTestRepo, setupTestDb, teardownTestDb } from './helpers/db';
import { saveRepo } from '$lib/server/db/user-saved-repos';

describe('personalized repository email alerts', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.RESEND_API_KEY;
		delete process.env.EMAIL_FROM;
		delete process.env.PUBLIC_APP_URL;
		teardownTestDb();
	});

	it('ranks only new repositories that overlap saved interests', () => {
		const seeds: InterestSeed[] = [
			{ id: 1, language: 'TypeScript', topics: ['llm', 'agents'], clusters: ['ai-tooling'] }
		];
		const candidates: RecommendationCandidate[] = [
			{
				id: 2,
				owner: 'acme',
				name: 'agent-kit',
				fullName: 'acme/agent-kit',
				description: 'Agent toolkit',
				language: 'TypeScript',
				topics: ['agents'],
				clusters: ['ai-tooling'],
				interestingScore: 70,
				stars: 20,
				firstSeenAt: '2026-08-02T12:00:00.000Z'
			},
			{
				id: 3,
				owner: 'other',
				name: 'css-theme',
				fullName: 'other/css-theme',
				description: 'CSS themes',
				language: 'CSS',
				topics: ['design'],
				clusters: ['frontend'],
				interestingScore: 99,
				stars: 500,
				firstSeenAt: '2026-08-02T13:00:00.000Z'
			}
		];

		const ranked = rankPersonalizedRecommendations(seeds, candidates);
		expect(ranked).toHaveLength(1);
		expect(ranked[0]).toMatchObject({ id: 2, fullName: 'acme/agent-kit' });
		expect(ranked[0].reasons).toEqual(
			expect.arrayContaining([
				'TypeScript matches your saved projects',
				'shared topics: agents',
				'related area: ai-tooling'
			])
		);
	});

	it('stores opt-in preferences and prevents duplicate delivery rows', () => {
		const now = new Date().toISOString();
		getDb()
			.prepare(
				`INSERT INTO users
				 (id, name, email, role, created_at, updated_at)
				 VALUES ('user-1', 'Ada', 'ada@example.com', 'user', ?, ?)`
			)
			.run(now, now);
		const repo = createTestRepo();

		expect(getUserEmailPreference('user-1')).toMatchObject({ enabled: false, minimumScore: 55 });
		updateUserEmailPreference('user-1', { enabled: true, minimumScore: 65 });
		expect(listEnabledEmailDigestUsers()).toEqual([
			expect.objectContaining({ id: 'user-1', email: 'ada@example.com', minimumScore: 65 })
		]);

		markUserDigestSent('user-1', [repo.id, repo.id], 'digest-1', 'provider-1', now);
		const deliveries = (
			getDb()
				.prepare('SELECT COUNT(*) AS count FROM personalized_email_deliveries WHERE user_id = ?')
				.get('user-1') as { count: number }
		).count;
		expect(deliveries).toBe(1);
		expect(getUserEmailPreference('user-1').lastDigestAt).toBe(now);
	});

	it('renders safe email content and sends it through the configured HTTPS provider', async () => {
		process.env.PUBLIC_APP_URL = 'https://archive.example';
		process.env.RESEND_API_KEY = 'test-key';
		process.env.EMAIL_FROM = 'GithubArchive+ <discoveries@example.com>';
		const message = renderPersonalizedDigest(
			{ name: '<Ada>', email: 'ada@example.com' },
			[
				{
					id: 2,
					owner: 'acme',
					name: 'agent-kit',
					fullName: 'acme/<agent-kit>',
					description: '<script>alert(1)</script>',
					language: 'TypeScript',
					topics: ['agents'],
					clusters: [],
					interestingScore: 70,
					stars: 20,
					firstSeenAt: '2026-08-02T12:00:00.000Z',
					matchScore: 80,
					reasons: ['shared topics: agents']
				}
			]
		);
		expect(message.html).not.toContain('<script>');
		expect(message.html).toContain('&lt;script&gt;');

		let request: { input: string; init?: RequestInit } | null = null;
		const providerId = await sendPersonalizedEmail(message, (async (input, init) => {
			request = { input: String(input), init };
			return new Response(JSON.stringify({ id: 'email-123' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}) as typeof fetch);

		expect(providerId).toBe('email-123');
		expect(request?.input).toBe('https://api.resend.com/emails');
		expect(request?.init?.method).toBe('POST');
	});

	it('sends each matching repository only once across repeated digest runs', async () => {
		const now = new Date().toISOString();
		getDb()
			.prepare(
				`INSERT INTO users
				 (id, name, email, role, created_at, updated_at)
				 VALUES ('user-1', 'Ada', 'ada@example.com', 'user', ?, ?)`
			)
			.run(now, now);
		const seed = createTestRepo({ topics: ['agents'] });
		const match = createTestRepo({ topics: ['agents', 'llm'] });
		getDb()
			.prepare(
				`UPDATE repos
				 SET language = 'TypeScript', interesting_score = ?, first_seen_at = ?,
				     enriched_at = ?, description = ?
				 WHERE id = ?`
			)
			.run(62, now, now, 'Saved agent project', seed.id);
		getDb()
			.prepare(
				`UPDATE repos
				 SET language = 'TypeScript', interesting_score = ?, first_seen_at = ?,
				     enriched_at = ?, description = ?
				 WHERE id = ?`
			)
			.run(78, now, now, 'New agent project', match.id);
		saveRepo('user-1', seed.id, null);
		updateUserEmailPreference('user-1', { enabled: true, minimumScore: 55 });
		process.env.RESEND_API_KEY = 'test-key';
		process.env.EMAIL_FROM = 'GithubArchive+ <discoveries@example.com>';
		process.env.PUBLIC_APP_URL = 'https://archive.example';

		const provider = vi.fn(async () =>
			new Response(JSON.stringify({ id: 'email-123' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		vi.stubGlobal('fetch', provider);

		const first = await runPersonalizedEmailDigest();
		expect(first).toMatchObject({ usersEmailed: 1, recommendationsSent: 1 });
		expect(provider).toHaveBeenCalledTimes(1);

		const second = await runPersonalizedEmailDigest();
		expect(second).toMatchObject({ usersEmailed: 0, skippedWithoutMatches: 1 });
		expect(provider).toHaveBeenCalledTimes(1);
		expect(
			getDb()
				.prepare('SELECT repo_id FROM personalized_email_deliveries WHERE user_id = ?')
				.all('user-1')
		).toEqual([{ repo_id: match.id }]);
	});
});
