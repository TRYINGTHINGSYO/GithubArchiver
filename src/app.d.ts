/// <reference types="@sveltejs/kit" />

import type { Session } from '@auth/core/types';
import type { AuthUser, Viewer } from '$lib/server/auth/types';

declare global {
	namespace App {
		interface Locals {
			isAdmin: boolean;
			collectionOwner: import('$lib/server/collection-owner').CollectionOwner;
			session: Session | null;
			user: AuthUser | null;
		}

		interface PageData {
			user?: Viewer | null;
		}
	}
}

export {};
