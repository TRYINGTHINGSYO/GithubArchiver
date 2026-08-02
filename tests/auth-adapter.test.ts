import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { githubArchiveAdapter } from '$lib/server/auth/adapter';
import { roleForGithubIdentity, syncGithubIdentity } from '$lib/server/auth/roles';
import { getDb } from '$lib/server/db/connection';
import { listSavedRepos, removeSavedRepo, saveRepo } from '$lib/server/db/user-saved-repos';
import { createTestRepo, setupTestDb, teardownTestDb } from './helpers/db';

describe('Auth.js SQLite adapter and saved repositories', () => {
	beforeEach(() => {
		process.env.ADMIN_GITHUB_IDS = '42';
		process.env.ADMIN_GITHUB_LOGINS = 'octoadmin';
		setupTestDb();
	});

	afterEach(() => {
		delete process.env.ADMIN_GITHUB_IDS;
		delete process.env.ADMIN_GITHUB_LOGINS;
		teardownTestDb();
	});

	it('creates a GitHub user, account, and database session', async () => {
		const user = await githubArchiveAdapter.createUser!({
			id: '42',
			name: 'Octo Admin',
			email: 'admin@example.com',
			emailVerified: null,
			image: 'https://example.com/avatar.png',
			githubLogin: 'octoadmin'
		} as Parameters<NonNullable<typeof githubArchiveAdapter.createUser>>[0] & { githubLogin: string });
		expect(user).toMatchObject({ id: '42', role: 'admin', githubLogin: 'octoadmin' });

		await githubArchiveAdapter.linkAccount!({
			userId: user.id,
			type: 'oauth',
			provider: 'github',
			providerAccountId: '42',
			access_token: 'secret-token'
		});
		expect(
			await githubArchiveAdapter.getUserByAccount!({
				provider: 'github',
				providerAccountId: '42'
			})
		).toMatchObject({ id: '42', role: 'admin' });

		const expires = new Date(Date.now() + 60_000);
		await githubArchiveAdapter.createSession!({
			sessionToken: 'session-token',
			userId: user.id,
			expires
		});
		const sessionAndUser = await githubArchiveAdapter.getSessionAndUser!('session-token');
		expect(sessionAndUser?.session).toMatchObject({ sessionToken: 'session-token', userId: '42' });
		expect(sessionAndUser?.session.expires.toISOString()).toBe(expires.toISOString());
		expect(sessionAndUser?.user).toMatchObject({ id: '42', role: 'admin' });
	});

	it('syncs allowlisted GitHub roles without trusting client input', async () => {
		const user = await githubArchiveAdapter.createUser!({
			id: '77',
			name: 'Regular User',
			email: 'regular@example.com',
			emailVerified: null,
			image: null,
			githubLogin: 'regular'
		} as Parameters<NonNullable<typeof githubArchiveAdapter.createUser>>[0] & { githubLogin: string });
		expect(user).toMatchObject({ role: 'user' });
		expect(roleForGithubIdentity('77', 'octoadmin')).toBe('admin');

		syncGithubIdentity('77', 'octoadmin');
		const row = getDb().prepare('SELECT role, github_login FROM users WHERE id = ?').get('77');
		expect(row).toEqual({ role: 'admin', github_login: 'octoadmin' });
	});

	it('stores saved repositories under the owning user', async () => {
		const user = await githubArchiveAdapter.createUser!({
			id: '88',
			name: 'Researcher',
			email: 'researcher@example.com',
			emailVerified: null,
			image: null,
			githubLogin: 'researcher'
		} as Parameters<NonNullable<typeof githubArchiveAdapter.createUser>>[0] & { githubLogin: string });
		const repo = createTestRepo();

		expect(saveRepo(user.id, repo.id, 'Watch the release cadence')).toBe(true);
		expect(listSavedRepos(user.id)).toEqual([
			expect.objectContaining({
				repo_id: repo.id,
				full_name: repo.full_name,
				notes: 'Watch the release cadence'
			})
		]);
		expect(removeSavedRepo(user.id, repo.id)).toBe(true);
		expect(listSavedRepos(user.id)).toEqual([]);
	});
});
