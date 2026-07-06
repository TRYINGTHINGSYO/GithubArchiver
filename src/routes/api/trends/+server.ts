import { json } from '@sveltejs/kit';
import { getLiveOverview, getTrendSnapshot } from '$lib/server/intelligence';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json({
		trends: getTrendSnapshot(),
		overview: getLiveOverview()
	});
};
