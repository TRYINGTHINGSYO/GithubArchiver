import { getDb } from './connection';
import { isMetadataOnlyMode } from '../runtime-mode';

export interface ArchivePulseRepo {
	owner: string;
	name: string;
	full_name: string;
	at: string;
	detail: string | null;
}

export interface ArchivePulse {
	metadataOnly: boolean;
	totalRepos: number;
	preservedRepos: number;
	readmeSaved: number;
	sourceSaved: number;
	zipAvailable: number;
	deletedButSaved: number;
	githubArchivedSaved: number;
	readmeChanges: number;
	releasesSaved: number;
	lastSeenOnGithub: string | null;
	recentPreserved: ArchivePulseRepo[];
	recentDeletedSaved: ArchivePulseRepo[];
	recentReadmeChanges: ArchivePulseRepo[];
}

function count(sql: string): number {
	return (getDb().prepare(sql).get() as { c: number }).c;
}

export function getArchivePulse(): ArchivePulse {
	const db = getDb();
	const metadataOnly = isMetadataOnlyMode();
	const recentPreserved = db
		.prepare(
			`SELECT r.owner, r.name, r.full_name, MAX(a.archived_at) as at,
			        GROUP_CONCAT(DISTINCT a.snapshot_type) as detail
			 FROM archive_snapshots a
			 JOIN repos r ON r.id = a.repo_id
			 GROUP BY r.id
			 ORDER BY at DESC
			 LIMIT 5`
		)
		.all() as ArchivePulseRepo[];

	const recentDeletedSaved = db
		.prepare(
			`SELECT r.owner, r.name, r.full_name, r.deleted_at as at,
			        'deleted but preserved locally' as detail
			 FROM repos r
			 WHERE r.deleted_at IS NOT NULL
			   AND EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = r.id)
			 ORDER BY r.deleted_at DESC
			 LIMIT 5`
		)
		.all() as ArchivePulseRepo[];

	const recentReadmeChanges = db
		.prepare(
			`SELECT r.owner, r.name, r.full_name, e.event_time as at,
			        'README changed' as detail
			 FROM repository_events e
			 JOIN repos r ON r.id = e.repo_id
			 WHERE e.event_type = 'readme_changed'
			 ORDER BY e.event_time DESC
			 LIMIT 5`
		)
		.all() as ArchivePulseRepo[];

	const lastSeen = db
		.prepare(
			`SELECT MAX(last_checked_at) as at
			 FROM repos
			 WHERE last_checked_at IS NOT NULL`
		)
		.get() as { at: string | null };

	return {
		metadataOnly,
		totalRepos: count('SELECT COUNT(*) as c FROM repos'),
		preservedRepos: metadataOnly ? 0 : count('SELECT COUNT(DISTINCT repo_id) as c FROM archive_snapshots'),
		readmeSaved: metadataOnly ? 0 : count(
			`SELECT COUNT(DISTINCT repo_id) as c FROM archive_snapshots WHERE snapshot_type = 'readme'`
		),
		sourceSaved: metadataOnly ? 0 : count(
			`SELECT COUNT(DISTINCT repo_id) as c FROM archive_snapshots WHERE snapshot_type = 'source'`
		),
		zipAvailable: metadataOnly ? 0 : count(
			`SELECT COUNT(DISTINCT repo_id) as c
			 FROM archive_snapshots
			 WHERE snapshot_type IN ('source', 'zip')`
		),
		deletedButSaved: metadataOnly ? 0 : count(
			`SELECT COUNT(DISTINCT r.id) as c
			 FROM repos r
			 JOIN archive_snapshots a ON a.repo_id = r.id
			 WHERE r.deleted_at IS NOT NULL`
		),
		githubArchivedSaved: metadataOnly ? 0 : count(
			`SELECT COUNT(DISTINCT r.id) as c
			 FROM repos r
			 JOIN archive_snapshots a ON a.repo_id = r.id
			 WHERE r.github_archived = 1`
		),
		readmeChanges: metadataOnly ? 0 : count(
			`SELECT COUNT(*) as c FROM repository_events WHERE event_type = 'readme_changed'`
		),
		releasesSaved: count('SELECT COUNT(DISTINCT repo_id) as c FROM releases'),
		lastSeenOnGithub: lastSeen.at,
		recentPreserved: metadataOnly ? [] : recentPreserved,
		recentDeletedSaved: metadataOnly ? [] : recentDeletedSaved,
		recentReadmeChanges: metadataOnly ? [] : recentReadmeChanges
	};
}
