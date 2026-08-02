import { getDb } from './connection';

export interface SavedRepoRow {
	repo_id: number;
	owner: string;
	name: string;
	full_name: string;
	description: string | null;
	language: string | null;
	stars: number | null;
	github_url: string;
	notes: string | null;
	saved_at: string;
}

export function listSavedRepos(userId: string, limit = 100): SavedRepoRow[] {
	const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)));
	return getDb()
		.prepare(
			`SELECT
			  r.id AS repo_id, r.owner, r.name, r.full_name, r.description, r.language,
			  r.stars, r.github_url, s.notes, s.created_at AS saved_at
			 FROM user_saved_repos s
			 JOIN repos r ON r.id = s.repo_id
			 WHERE s.user_id = ?
			 ORDER BY s.created_at DESC, r.id DESC
			 LIMIT ?`
		)
		.all(userId, safeLimit) as SavedRepoRow[];
}

export function saveRepo(userId: string, repoId: number, notes: string | null): boolean {
	const exists = getDb().prepare('SELECT 1 FROM repos WHERE id = ?').get(repoId);
	if (!exists) return false;

	getDb()
		.prepare(
			`INSERT INTO user_saved_repos (user_id, repo_id, notes, created_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(user_id, repo_id) DO UPDATE SET notes = excluded.notes`
		)
		.run(userId, repoId, notes, new Date().toISOString());
	return true;
}

export function removeSavedRepo(userId: string, repoId: number): boolean {
	return getDb()
		.prepare('DELETE FROM user_saved_repos WHERE user_id = ? AND repo_id = ?')
		.run(userId, repoId).changes > 0;
}
