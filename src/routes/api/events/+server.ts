import { json } from '@sveltejs/kit';
import { eventLabel, listMemoryEvents, listRecentEvents, parseEventPayload, type RepoEventType } from '$lib/server/events';
import { REPO_EVENT_TYPES } from '$lib/server/events';
import { boundedInteger, positiveInteger } from '$lib/server/number-params';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const limit = boundedInteger(url.searchParams.get('limit'), 100, { min: 1, max: 500 });
	const eventType = url.searchParams.get('type') as RepoEventType | null;
	const since = url.searchParams.get('since') ?? undefined;
	const repoId = positiveInteger(url.searchParams.get('repo_id'));
	const sinceLiveId = positiveInteger(url.searchParams.get('since_live_id'));

	if (eventType && !REPO_EVENT_TYPES.includes(eventType)) {
		return json({ error: 'invalid event type' }, { status: 400 });
	}

	const events = listRecentEvents({
		limit,
		eventType: eventType ?? undefined,
		since,
		repoId
	}).map((e) => ({
		id: e.id,
		repo_id: e.repo_id,
		owner: e.owner,
		name: e.name,
		full_name: e.full_name,
		event_type: e.event_type,
		label: eventLabel(e.event_type as RepoEventType),
		event_time: e.event_time,
		payload: parseEventPayload(e.payload_json)
	}));

	const memoryEvents = listMemoryEvents({
		sinceId: sinceLiveId,
		limit
	});

	return json({ events, memoryEvents, count: events.length });
};
