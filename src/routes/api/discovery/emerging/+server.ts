import { json } from '@sveltejs/kit';
import {
	getLatestEmergingDetectionProvenance,
	listEmergingTopics,
	runEmergingTopicDetection,
	type EmergingTopicStatus
} from '$lib/server/emerging-topics';
import type { RequestHandler } from './$types';

const STATUSES = new Set(['detected', 'reviewing', 'promoted', 'dismissed', 'expired']);

export const GET: RequestHandler = async ({ url }) => {
	const statusRaw = url.searchParams.get('status') ?? undefined;
	const status = statusRaw && STATUSES.has(statusRaw) ? (statusRaw as EmergingTopicStatus) : undefined;
	const limit = Number(url.searchParams.get('limit') ?? 50);
	const detect = url.searchParams.get('detect') === '1';
	const detection = detect
		? runEmergingTopicDetection({ limit: Math.min(Math.max(1, limit), 100) })
		: null;
	return json({
		topics: listEmergingTopics({ status, limit: Math.min(Math.max(1, limit), 100) }),
		detection,
		provenance: detection?.comparability ?? getLatestEmergingDetectionProvenance()
	});
};
