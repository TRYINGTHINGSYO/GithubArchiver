import { json } from '@sveltejs/kit';
import {
	INTELLIGENCE_REVIEW_OUTCOMES,
	saveIntelligenceReview,
	type IntelligenceReviewOutcome
} from '$lib/server/intelligence-audit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		repositoryId?: number;
		outcome?: string;
		notes?: string;
		reviewedCategory?: string;
		reviewedClusterSlug?: string;
	};

	if (!body.repositoryId || !body.outcome) {
		return json({ error: 'repositoryId and outcome are required' }, { status: 400 });
	}
	if (!INTELLIGENCE_REVIEW_OUTCOMES.includes(body.outcome as IntelligenceReviewOutcome)) {
		return json(
			{ error: `outcome must be one of: ${INTELLIGENCE_REVIEW_OUTCOMES.join(', ')}` },
			{ status: 400 }
		);
	}

	const id = saveIntelligenceReview({
		repositoryId: body.repositoryId,
		outcome: body.outcome as IntelligenceReviewOutcome,
		notes: body.notes ?? null,
		reviewedCategory: body.reviewedCategory ?? null,
		reviewedClusterSlug: body.reviewedClusterSlug ?? null,
		reviewedBy: 'admin'
	});

	return json({ ok: true, id });
};
