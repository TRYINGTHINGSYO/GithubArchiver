import { getDb } from './connection.js';
import type { ArchiveStoryResult } from '$lib/server/archive-story-types';
import type { RepoRow } from './types.js';

export interface StoredArchiveStory {
	story_facts_json: string;
	story_text: string | null;
	story_version: number | null;
	story_generated_at: string | null;
}

export function saveArchiveStory(repoId: number, result: ArchiveStoryResult): void {
	const db = getDb();
	db.prepare(
		`UPDATE repos SET
		   story_facts_json = ?,
		   story_text = ?,
		   story_version = ?,
		   story_generated_at = ?
		 WHERE id = ?`
	).run(
		JSON.stringify(result.facts),
		result.story,
		result.version,
		result.generatedAt,
		repoId
	);
}

export function getStoredArchiveStory(repoId: number): StoredArchiveStory | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT story_facts_json, story_text, story_version, story_generated_at
			 FROM repos WHERE id = ?`
		)
		.get(repoId) as StoredArchiveStory | undefined;
	if (!row?.story_facts_json) return null;
	return row;
}

export function listReposForStoryGeneration(
	limit: number,
	afterId: number,
	targetVersion: number,
	force: boolean
): RepoRow[] {
	const db = getDb();
	if (force) {
		return db
			.prepare(
				`SELECT * FROM repos
				 WHERE enriched_at IS NOT NULL AND id > ?
				 ORDER BY id ASC
				 LIMIT ?`
			)
			.all(afterId, limit) as RepoRow[];
	}

	return db
		.prepare(
			`SELECT * FROM repos
			 WHERE enriched_at IS NOT NULL
			   AND id > ?
			   AND (story_version IS NULL OR story_version < ?)
			 ORDER BY id ASC
			 LIMIT ?`
		)
		.all(afterId, targetVersion, limit) as RepoRow[];
}
