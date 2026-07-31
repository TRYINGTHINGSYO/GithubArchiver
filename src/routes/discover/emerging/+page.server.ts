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
				duplicateAnalysis?: {
					classification?: string;
					hiddenRelatedCopyCount?: number;
					rawCurrentCount?: number;
					independentCurrentCount?: number;
					warning?: string | null;
				};
			};
			growthSuppressedReason = evidence.growthSuppressedReason ?? null;
			prevalenceLiftPercent = evidence.prevalence?.liftPercent ?? null;
			const duplicateAnalysis = evidence.duplicateAnalysis;
			return {
				...topic,
				growth_suppressed_reason: growthSuppressedReason,
				prevalence_lift_percent: prevalenceLiftPercent,
				duplicate_classification: duplicateAnalysis?.classification ?? 'verified-emerging-topic',
				hidden_related_copy_count: duplicateAnalysis?.hiddenRelatedCopyCount ?? 0,
				raw_current_count: duplicateAnalysis?.rawCurrentCount ?? topic.current_count,
				independent_current_count: duplicateAnalysis?.independentCurrentCount ?? topic.current_count,
				duplicate_warning: duplicateAnalysis?.warning ?? null
			};
		} catch {
			/* legacy rows without the field */
		}
		return {
			...topic,
			growth_suppressed_reason: growthSuppressedReason,
			prevalence_lift_percent: prevalenceLiftPercent,
			duplicate_classification: 'verified-emerging-topic',
			hidden_related_copy_count: 0,
			raw_current_count: topic.current_count,
			independent_current_count: topic.current_count,
			duplicate_warning: null
		};
	});

	return {
		topics,
		readiness,
		provenance: getLatestEmergingDetectionProvenance()
	};
};
