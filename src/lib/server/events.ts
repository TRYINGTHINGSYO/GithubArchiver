import { insertRepoEvent, listRecentEvents as listRecentEventsDb, listRepoEvents as listRepoEventsDb } from '$lib/server/db/events';
import type { RepoEventRow } from '$lib/server/db/types';
import { listLiveEvents, publishLiveEvent } from '$lib/server/event-bus';

export const REPO_EVENT_TYPES = [
	'first_seen',
	'metadata_updated',
	'metrics_updated',
	'default_branch_updated',
	'license_changed',
	'topics_changed',
	'readme_changed',
	'snapshot_created',
	'release_detected',
	'renamed',
	'archived',
	'unarchived',
	'deleted',
	'enrichment_failed',
	'archive_failed'
] as const;

export type RepoEventType = (typeof REPO_EVENT_TYPES)[number];

export type { RepoEventRow };

export function appendRepoEvent(
	repoId: number,
	eventType: RepoEventType,
	payload: Record<string, unknown>,
	eventTime?: string
): number {
	const time = eventTime ?? new Date().toISOString();
	const id = insertRepoEvent(repoId, eventType, JSON.stringify(payload), time);
	publishLiveEvent({
		type: toLiveBusEventType(eventType),
		repo_id: repoId,
		event_time: time,
		payload: { ...payload, archive_event_type: eventType }
	});
	return id;
}

function toLiveBusEventType(eventType: RepoEventType): 'repo.created' | 'repo.updated' | 'repo.archived' | 'repo.enriched' {
	switch (eventType) {
		case 'first_seen':
			return 'repo.created';
		case 'archived':
		case 'unarchived':
		case 'snapshot_created':
			return 'repo.archived';
		case 'metadata_updated':
		case 'metrics_updated':
		case 'default_branch_updated':
		case 'license_changed':
		case 'topics_changed':
		case 'readme_changed':
		case 'release_detected':
			return 'repo.enriched';
		default:
			return 'repo.updated';
	}
}

export function listRepoEvents(repoId: number, limit = 200): RepoEventRow[] {
	return listRepoEventsDb(repoId, limit);
}

export function listRecentEvents(opts: {
	limit?: number;
	eventType?: RepoEventType;
	since?: string;
	repoId?: number;
}): (RepoEventRow & { owner: string; name: string; full_name: string })[] {
	return listRecentEventsDb({
		limit: opts.limit,
		eventType: opts.eventType,
		since: opts.since,
		repoId: opts.repoId
	});
}

export function listMemoryEvents(opts: { sinceId?: number; limit?: number } = {}) {
	return listLiveEvents(opts);
}

export function eventLabel(eventType: RepoEventType): string {
	switch (eventType) {
		case 'first_seen':
			return 'New repository';
		case 'metadata_updated':
			return 'Metadata updated';
		case 'metrics_updated':
			return 'Stars increased';
		case 'default_branch_updated':
			return 'Default branch updated';
		case 'license_changed':
			return 'License changed';
		case 'topics_changed':
			return 'Topics changed';
		case 'readme_changed':
			return 'README updated';
		case 'snapshot_created':
			return 'Snapshot archived';
		case 'release_detected':
			return 'Release published';
		case 'renamed':
			return 'Repository renamed';
		case 'archived':
			return 'Repository archived on GitHub';
		case 'unarchived':
			return 'Repository unarchived on GitHub';
		case 'deleted':
			return 'Repository deleted';
		case 'enrichment_failed':
			return 'Enrichment failed';
		case 'archive_failed':
			return 'Archive failed';
		default:
			return eventType;
	}
}

export function parseEventPayload(payloadJson: string): Record<string, unknown> {
	try {
		return JSON.parse(payloadJson) as Record<string, unknown>;
	} catch {
		return {};
	}
}
