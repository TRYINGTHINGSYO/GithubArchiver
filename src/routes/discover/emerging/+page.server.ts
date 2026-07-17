import { getDataReadiness } from '$lib/server/data-readiness';
import {
	getLatestEmergingDetectionProvenance,
	listEmergingTopics
} from '$lib/server/emerging-topics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const periodEndRaw = url.searchParams.get('period_end');
	const periodEnd = periodEndRaw ? new Date(periodEndRaw) : undefined;
	const readiness = getDataReadiness({
		windowDays: 7,
		periodEnd: periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd : undefined
	});

	const topics = listEmergingTopics({ limit: Math.min(Math.max(1, limit), 100) }).map((topic) => {
		let growthSuppressedReason: string | null = null;
		let prevalenceLiftPercent: number | null = null;
		try {
			const evidence = JSON.parse(topic.evidence_json) as {
				growthSuppressedReason?: string | null;
				prevalence?: { liftPercent?: number | null };
			};
			growthSuppressedReason = evidence.growthSuppressedReason ?? null;
			prevalenceLiftPercent = evidence.prevalence?.liftPercent ?? null;
		} catch {
			/* legacy rows without the field */
		}
		return {
			...topic,
			growth_suppressed_reason: growthSuppressedReason,
			prevalence_lift_percent: prevalenceLiftPercent
		};
	});

	return {
		topics,
		readiness,
		provenance: getLatestEmergingDetectionProvenance()
	};
};
