import { getDb } from './connection';
import type { RepoEventRow } from './types';

export function insertRepoEvent(
	repoId: number,
	eventType: string,
	payloadJson: string,
	eventTime: string
): number {
	const database = getDb();
	const result = database
		.prepare(
			`INSERT INTO repository_events (repo_id, event_type, event_time, payload_json)
			 VALUES (?, ?, ?, ?)`
		)
		.run(repoId, eventType, eventTime, payloadJson);
	return Number(result.lastInsertRowid);
}

export function listRepoEvents(repoId: number, limit = 200): RepoEventRow[] {
	const database = getDb();
	return database
		.prepare(
			`SELECT * FROM repository_events WHERE repo_id = ?
			 AND event_time GLOB '????-??-??T*'
			 ORDER BY event_time DESC LIMIT ?`
		)
		.all(repoId, limit) as RepoEventRow[];
}

export function listRecentEvents(opts: {
	limit?: number;
	eventType?: string;
	since?: string;
	repoId?: number;
}): (RepoEventRow & { owner: string; name: string; full_name: string })[] {
	const database = getDb();
	const limit = opts.limit ?? 100;
	const where: string[] = ["e.event_time GLOB '????-??-??T*'"];
	const params: (string | number)[] = [];

	if (opts.eventType) {
		where.push('e.event_type = ?');
		params.push(opts.eventType);
	}
	if (opts.since) {
		where.push('e.event_time >= ?');
		params.push(opts.since);
	}
	if (opts.repoId) {
		where.push('e.repo_id = ?');
		params.push(opts.repoId);
	}

	const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

	return database
		.prepare(
			`SELECT e.*, r.owner, r.name, r.full_name
			 FROM repository_events e
			 JOIN repos r ON r.id = e.repo_id
			 ${whereClause}
			 ORDER BY e.event_time DESC
			 LIMIT ?`
		)
		.all(...params, limit) as (RepoEventRow & { owner: string; name: string; full_name: string })[];
}
