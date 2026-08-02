import { json } from '@sveltejs/kit';
import { listLatestReleases } from '$lib/server/db';
import { boundedInteger } from '$lib/server/number-params';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const limit = boundedInteger(url.searchParams.get('limit'), 50, { min: 1, max: 100 });
	const releases = listLatestReleases(limit);
	return json({ releases, count: releases.length });
};
