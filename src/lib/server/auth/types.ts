import type { AdapterUser } from '@auth/core/adapters';

export type UserRole = 'user' | 'admin';

export interface AuthUser extends AdapterUser {
	role: UserRole;
	githubLogin: string | null;
}

export type Viewer = Pick<AuthUser, 'id' | 'name' | 'email' | 'image' | 'role' | 'githubLogin'>;

export interface AuthUserRow {
	id: string;
	name: string | null;
	email: string | null;
	email_verified: string | null;
	image: string | null;
	github_login: string | null;
	role: UserRole;
}

export function toAuthUser(row: AuthUserRow): AuthUser {
	return {
		id: row.id,
		name: row.name,
		email: row.email ?? '',
		emailVerified: row.email_verified ? new Date(row.email_verified) : null,
		image: row.image,
		role: row.role,
		githubLogin: row.github_login
	};
}
