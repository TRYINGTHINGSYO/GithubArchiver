import { getDb } from './connection';

export interface RepoFavoriteRow {
	repo_id: number;
	favorited_at: string;
}

export function isRepoFavorited(repoId: number): boolean {
	const row = getDb().prepare('SELECT 1 FROM repo_favorites WHERE repo_id = ?').get(repoId);
	return Boolean(row);
}

export function getRepoFavorite(repoId: number): RepoFavoriteRow | null {
	const row = getDb()
		.prepare('SELECT repo_id, favorited_at FROM repo_favorites WHERE repo_id = ?')
		.get(repoId) as RepoFavoriteRow | undefined;
	return row ?? null;
}

export function setRepoFavorite(repoId: number, favorite: boolean): RepoFavoriteRow | null {
	const db = getDb();
	if (favorite) {
		const favoritedAt = new Date().toISOString();
		db.prepare(
			`INSERT INTO repo_favorites (repo_id, favorited_at)
			 VALUES (?, ?)
			 ON CONFLICT(repo_id) DO UPDATE SET favorited_at = repo_favorites.favorited_at`
		).run(repoId, favoritedAt);
		return getRepoFavorite(repoId);
	}
	db.prepare('DELETE FROM repo_favorites WHERE repo_id = ?').run(repoId);
	return null;
}

export function listFavoriteRepoIds(): Set<number> {
	const rows = getDb().prepare('SELECT repo_id FROM repo_favorites').all() as { repo_id: number }[];
	return new Set(rows.map((row) => row.repo_id));
}
