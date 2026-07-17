import { json } from '@sveltejs/kit';
import { getDataReadiness } from '$lib/server/data-readiness';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const windowDays = Number(url.searchParams.get('window_days') ?? 7);
	const periodEndRaw = url.searchParams.get('period_end');
	const periodEnd = periodEndRaw ? new Date(periodEndRaw) : undefined;
	if (periodEnd && Number.isNaN(periodEnd.getTime())) {
		return json({ error: 'Invalid period_end' }, { status: 400 });
	}

	return json(
		getDataReadiness({
			windowDays: Number.isFinite(windowDays) ? windowDays : 7,
			periodEnd
		})
	);
};
