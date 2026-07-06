export interface LiveBusEvent {
	id: number;
	type: string;
	repo_id: number;
	event_time: string;
	payload: Record<string, unknown>;
}

const MAX_EVENTS = 200;
let nextLiveId = 1;
const events: LiveBusEvent[] = [];

export function publishLiveEvent(event: Omit<LiveBusEvent, 'id'>): LiveBusEvent {
	const liveEvent = { ...event, id: nextLiveId++ };
	events.unshift(liveEvent);
	if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
	return liveEvent;
}

export function listLiveEvents(opts: { sinceId?: number; limit?: number } = {}): LiveBusEvent[] {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), MAX_EVENTS);
	return events
		.filter((event) => opts.sinceId === undefined || event.id > opts.sinceId)
		.slice(0, limit);
}
