import { SvelteKitAuth, type SvelteKitAuthConfig } from '@auth/sveltekit';
import GitHub, { type GitHubProfile } from '@auth/sveltekit/providers/github';
import { githubArchiveAdapter } from '$lib/server/auth/adapter';
import { roleForGithubIdentity, syncGithubIdentity } from '$lib/server/auth/roles';
import type { AuthUser } from '$lib/server/auth/types';

export const authConfig: SvelteKitAuthConfig = {
	adapter: githubArchiveAdapter,
	providers: [
		GitHub({
			profile(profile) {
				const id = String(profile.id);
				return {
					id,
					name: profile.name ?? profile.login,
					email: profile.email,
					image: profile.avatar_url,
					githubLogin: profile.login,
					role: roleForGithubIdentity(id, profile.login)
				};
			}
		})
	],
	session: {
		strategy: 'database'
	},
	callbacks: {
		session({ session, user }) {
			const authUser = user as AuthUser;
			const sessionUser = session.user as typeof session.user & {
				id: string;
				role: AuthUser['role'];
				githubLogin: string | null;
			};
			sessionUser.id = authUser.id;
			sessionUser.role = authUser.role;
			sessionUser.githubLogin = authUser.githubLogin;
			return session;
		}
	},
	events: {
		signIn({ user, account, profile }) {
			if (account?.provider !== 'github' || !profile || typeof user.id !== 'string') return;
			const githubProfile = profile as unknown as GitHubProfile;
			if (typeof githubProfile.login === 'string') {
				syncGithubIdentity(user.id, githubProfile.login);
			}
		}
	},
	trustHost: true
};

export const { handle, signIn, signOut } = SvelteKitAuth(authConfig);
