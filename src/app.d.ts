/// <reference types="@sveltejs/kit" />

declare global {
	namespace App {
		interface Locals {
			isAdmin: boolean;
			collectionOwner: import('$lib/server/collection-owner').CollectionOwner;
		}
	}
}

export {};
