import { json } from '@sveltejs/kit';
import { getDataReadiness } from '$lib/server/data-readiness';
import { boundedInteger } from '$lib/server/number-params';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const windowDays = boundedInteger(url.searchParams.get('window_days'), 7, { min: 1, max: 90 });
	const periodEndRaw = url.searchParams.get('period_end');
	const periodEnd = periodEndRaw ? new Date(periodEndRaw) : undefined;
	if (periodEnd && Number.isNaN(periodEnd.getTime())) {
		return json({ error: 'Invalid period_end' }, { status: 400 });
	}

	return json(
		getDataReadiness({
			windowDays,
			periodEnd
		})
	);
};
