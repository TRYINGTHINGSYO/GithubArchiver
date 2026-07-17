import { error, json } from '@sveltejs/kit';
import {
	EMERGING_REVIEW_REASONS,
	excludeEmergingTopic,
	getEmergingTopicDetail,
	mergeEmergingTopic,
	updateEmergingTopicStatus,
	type EmergingReviewReason,
	type EmergingTopicStatus
} from '$lib/server/emerging-topics';
import type { RequestHandler } from './$types';

const STATUSES = new Set(['detected', 'reviewing', 'promoted', 'dismissed', 'expired']);
const REASONS = new Set<string>(EMERGING_REVIEW_REASONS);

export const GET: RequestHandler = async ({ params }) => {
	const detail = getEmergingTopicDetail(params.key);
	if (!detail) error(404, 'Emerging topic not found');
	return json(detail);
};

export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		action?: 'set-status' | 'merge' | 'exclude';
		status?: string;
		reason?: string;
		canonicalKey?: string;
	};
	const action = body.action ?? 'set-status';
	const reason = body.reason as EmergingReviewReason | undefined;
	if (reason && !REASONS.has(reason)) error(400, 'Invalid review reason');

	if (action === 'merge') {
		if (!body.canonicalKey) error(400, 'canonicalKey is required to merge');
		const ok = mergeEmergingTopic(params.key, body.canonicalKey);
		if (!ok) error(404, 'Emerging topic not found');
		return json({ ok: true, key: params.key, action, canonicalKey: body.canonicalKey });
	}

	if (action === 'exclude') {
		const ok = excludeEmergingTopic(params.key, reason ?? 'generic-term');
		if (!ok) error(404, 'Emerging topic not found');
		return json({ ok: true, key: params.key, action, reason: reason ?? 'generic-term' });
	}

	if (!body.status || !STATUSES.has(body.status)) error(400, 'Invalid status');
	const ok = updateEmergingTopicStatus(params.key, body.status as EmergingTopicStatus, reason);
	if (!ok) error(404, 'Emerging topic not found');
	return json({ ok: true, key: params.key, status: body.status, reason: reason ?? null });
};
