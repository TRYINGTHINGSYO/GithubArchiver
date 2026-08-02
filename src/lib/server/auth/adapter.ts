import { randomUUID } from 'node:crypto';
import type {
	Adapter,
	AdapterAccount,
	AdapterSession,
	AdapterUser
} from '@auth/core/adapters';
import { getDb } from '$lib/server/db/connection';
import { roleForGithubIdentity } from './roles';
import { toAuthUser, type AuthUser, type AuthUserRow } from './types';

type AuthAccountRow = {
	id: string;
	user_id: string;
	type: AdapterAccount['type'];
	provider: string;
	provider_account_id: string;
	refresh_token: string | null;
	access_token: string | null;
	expires_at: number | null;
	token_type: string | null;
	scope: string | null;
	id_token: string | null;
	session_state: string | null;
};

type AuthSessionRow = {
	id: string;
	session_token: string;
	user_id: string;
	expires: string;
};

function nullableString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function getAuthUser(id: string): AuthUser | null {
	const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as
		| AuthUserRow
		| undefined;
	return row ? toAuthUser(row) : null;
}

function toAdapterAccount(row: AuthAccountRow): AdapterAccount {
	return {
		userId: row.user_id,
		type: row.type,
		provider: row.provider,
		providerAccountId: row.provider_account_id,
		refresh_token: row.refresh_token ?? undefined,
		access_token: row.access_token ?? undefined,
		expires_at: row.expires_at ?? undefined,
		token_type: (row.token_type ?? undefined) as AdapterAccount['token_type'],
		scope: row.scope ?? undefined,
		id_token: row.id_token ?? undefined,
		session_state: (row.session_state ?? undefined) as AdapterAccount['session_state']
	};
}

function toAdapterSession(row: AuthSessionRow): AdapterSession {
	return {
		sessionToken: row.session_token,
		userId: row.user_id,
		expires: new Date(row.expires)
	};
}

export const githubArchiveAdapter: Adapter = {
	createUser(user) {
		const id = user.id || randomUUID();
		const githubLogin = nullableString((user as AdapterUser & { githubLogin?: string }).githubLogin);
		const now = new Date().toISOString();
		getDb()
			.prepare(
				`INSERT INTO users
				 (id, name, email, email_verified, image, github_login, role, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				id,
				user.name ?? null,
				nullableString(user.email),
				user.emailVerified?.toISOString() ?? null,
				user.image ?? null,
				githubLogin,
				roleForGithubIdentity(id, githubLogin),
				now,
				now
			);
		return getAuthUser(id) as AuthUser;
	},

	getUser(id) {
		return getAuthUser(id);
	},

	getUserByEmail(email) {
		const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as
			| AuthUserRow
			| undefined;
		return row ? toAuthUser(row) : null;
	},

	getUserByAccount({ provider, providerAccountId }) {
		const row = getDb()
			.prepare(
				`SELECT u.*
				 FROM users u
				 JOIN oauth_accounts a ON a.user_id = u.id
				 WHERE a.provider = ? AND a.provider_account_id = ?`
			)
			.get(provider, providerAccountId) as AuthUserRow | undefined;
		return row ? toAuthUser(row) : null;
	},

	updateUser(user) {
		const current = getAuthUser(user.id);
		if (!current) throw new Error(`Cannot update missing user ${user.id}`);

		const name = user.name === undefined ? current.name : user.name;
		const email = user.email === undefined ? current.email : user.email;
		const emailVerified =
			user.emailVerified === undefined ? current.emailVerified : user.emailVerified;
		const image = user.image === undefined ? current.image : user.image;

		getDb()
			.prepare(
				`UPDATE users
				 SET name = ?, email = ?, email_verified = ?, image = ?, updated_at = ?
				 WHERE id = ?`
			)
			.run(
				name ?? null,
				nullableString(email),
				emailVerified?.toISOString() ?? null,
				image ?? null,
				new Date().toISOString(),
				user.id
			);
		return getAuthUser(user.id) as AuthUser;
	},

	async deleteUser(userId) {
		getDb().prepare('DELETE FROM users WHERE id = ?').run(userId);
	},

	linkAccount(account) {
		getDb()
			.prepare(
				`INSERT INTO oauth_accounts
				 (id, user_id, type, provider, provider_account_id, refresh_token, access_token,
				  expires_at, token_type, scope, id_token, session_state)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				randomUUID(),
				account.userId,
				account.type,
				account.provider,
				account.providerAccountId,
				nullableString(account.refresh_token),
				nullableString(account.access_token),
				typeof account.expires_at === 'number' ? account.expires_at : null,
				nullableString(account.token_type),
				nullableString(account.scope),
				nullableString(account.id_token),
				nullableString(account.session_state)
			);
		return account;
	},

	unlinkAccount({ provider, providerAccountId }) {
		const row = getDb()
			.prepare('SELECT * FROM oauth_accounts WHERE provider = ? AND provider_account_id = ?')
			.get(provider, providerAccountId) as AuthAccountRow | undefined;
		if (!row) return undefined;
		getDb()
			.prepare('DELETE FROM oauth_accounts WHERE provider = ? AND provider_account_id = ?')
			.run(provider, providerAccountId);
		return toAdapterAccount(row);
	},

	getAccount(providerAccountId, provider) {
		const row = getDb()
			.prepare('SELECT * FROM oauth_accounts WHERE provider = ? AND provider_account_id = ?')
			.get(provider, providerAccountId) as AuthAccountRow | undefined;
		return row ? toAdapterAccount(row) : null;
	},

	createSession(session) {
		getDb()
			.prepare(
				`INSERT INTO user_sessions (id, session_token, user_id, expires)
				 VALUES (?, ?, ?, ?)`
			)
			.run(randomUUID(), session.sessionToken, session.userId, session.expires.toISOString());
		return session;
	},

	getSessionAndUser(sessionToken) {
		const row = getDb()
			.prepare(
				`SELECT
				  s.id AS session_id, s.session_token, s.user_id, s.expires,
				  u.id, u.name, u.email, u.email_verified, u.image, u.github_login, u.role
				 FROM user_sessions s
				 JOIN users u ON u.id = s.user_id
				 WHERE s.session_token = ?`
			)
			.get(sessionToken) as
			| (AuthUserRow & { session_id: string; session_token: string; user_id: string; expires: string })
			| undefined;
		if (!row) return null;
		return {
			session: toAdapterSession({
				id: row.session_id,
				session_token: row.session_token,
				user_id: row.user_id,
				expires: row.expires
			}),
			user: toAuthUser(row)
		};
	},

	updateSession(session) {
		const current = getDb()
			.prepare('SELECT * FROM user_sessions WHERE session_token = ?')
			.get(session.sessionToken) as AuthSessionRow | undefined;
		if (!current) return null;

		const updated = {
			sessionToken: current.session_token,
			userId: session.userId ?? current.user_id,
			expires: session.expires ?? new Date(current.expires)
		};
		getDb()
			.prepare('UPDATE user_sessions SET user_id = ?, expires = ? WHERE session_token = ?')
			.run(updated.userId, updated.expires.toISOString(), updated.sessionToken);
		return updated;
	},

	deleteSession(sessionToken) {
		const row = getDb()
			.prepare('SELECT * FROM user_sessions WHERE session_token = ?')
			.get(sessionToken) as AuthSessionRow | undefined;
		if (!row) return null;
		getDb().prepare('DELETE FROM user_sessions WHERE session_token = ?').run(sessionToken);
		return toAdapterSession(row);
	}
};
