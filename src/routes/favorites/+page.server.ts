import {
	listCollectionRepositories,
	listCollectionWebsites
} from '$lib/server/db/collections';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store' });
	return {
		repositories: listCollectionRepositories(locals.collectionOwner, 'favorites'),
		websites: listCollectionWebsites(locals.collectionOwner, 'favorites'),
		isAdmin: locals.isAdmin
	};
};
