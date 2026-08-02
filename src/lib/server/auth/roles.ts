import { getDb } from '$lib/server/db/connection';
import type { UserRole } from './types';

function allowlist(name: 'ADMIN_GITHUB_IDS' | 'ADMIN_GITHUB_LOGINS'): Set<string> {
	return new Set(
		(process.env[name] ?? '')
			.split(',')
			.map((value) => value.trim().toLowerCase())
			.filter(Boolean)
	);
}

export function roleForGithubIdentity(userId: string, githubLogin: string | null): UserRole {
	if (allowlist('ADMIN_GITHUB_IDS').has(userId.trim().toLowerCase())) return 'admin';
	if (githubLogin && allowlist('ADMIN_GITHUB_LOGINS').has(githubLogin.trim().toLowerCase())) {
		return 'admin';
	}
	return 'user';
}

export function syncGithubIdentity(userId: string, githubLogin: string): void {
	const normalizedLogin = githubLogin.trim();
	if (!normalizedLogin) return;

	getDb()
		.prepare(
			`UPDATE users
			 SET github_login = ?, role = ?, updated_at = ?
			 WHERE id = ?`
		)
		.run(
			normalizedLogin,
			roleForGithubIdentity(userId, normalizedLogin),
			new Date().toISOString(),
			userId
		);
}
