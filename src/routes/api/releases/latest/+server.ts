import { json } from '@sveltejs/kit';
import { listLatestReleases } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 100);
	const releases = listLatestReleases(limit);
	return json({ releases, count: releases.length });
};
