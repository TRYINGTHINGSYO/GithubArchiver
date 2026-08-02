import { json } from '@sveltejs/kit';
import {
	getLatestEmergingDetectionProvenance,
	listEmergingTopics,
	runEmergingTopicDetection,
	type EmergingTopicStatus
} from '$lib/server/emerging-topics';
import type { RequestHandler } from './$types';
import { boundedInteger } from '$lib/server/number-params';

const STATUSES = new Set(['detected', 'reviewing', 'promoted', 'dismissed', 'expired']);

export const GET: RequestHandler = async ({ url }) => {
	if (url.searchParams.get('detect') === '1') {
		return json(
			{ ok: false, error: 'Detection is a write operation and requires an authenticated POST.' },
			{ status: 405, headers: { Allow: 'GET, POST' } }
		);
	}
	const statusRaw = url.searchParams.get('status') ?? undefined;
	const status = statusRaw && STATUSES.has(statusRaw) ? (statusRaw as EmergingTopicStatus) : undefined;
	const limit = boundedInteger(url.searchParams.get('limit'), 50, { min: 1, max: 100 });
	return json({
		topics: listEmergingTopics({ status, limit }),
		detection: null,
		provenance: getLatestEmergingDetectionProvenance()
	});
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.isAdmin) {
		return json({ ok: false, error: 'Admin login required.' }, { status: 401 });
	}
	const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
	const limit = boundedInteger(body.limit, 50, { min: 1, max: 100 });
	const detection = runEmergingTopicDetection({ limit });
	return json({
		ok: true,
		detection,
		provenance: detection.comparability
	});
};
