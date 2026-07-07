import { getDb } from './connection.js';
import type { RepoCategory } from '$lib/server/classify-repo';

export interface CategoryDailyRow {
	id: number;
	observed_at: string;
	category: string;
	repo_count: number;
	pct_of_total: number;
}

export function upsertCategoryDaily(
	observedAt: string,
	rows: { category: string; repo_count: number; pct_of_total: number }[]
): void {
	const db = getDb();
	const stmt = db.prepare(
		`INSERT INTO repo_category_daily (observed_at, category, repo_count, pct_of_total)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(observed_at, category) DO UPDATE SET
		   repo_count = excluded.repo_count,
		   pct_of_total = excluded.pct_of_total`
	);
	for (const row of rows) {
		stmt.run(observedAt, row.category, row.repo_count, row.pct_of_total);
	}
}

export function getLatestCategoryDaily(): CategoryDailyRow[] {
	const db = getDb();
	const latest = db
		.prepare('SELECT observed_at FROM repo_category_daily ORDER BY observed_at DESC LIMIT 1')
		.get() as { observed_at: string } | undefined;
	if (!latest) return [];
	return db
		.prepare('SELECT * FROM repo_category_daily WHERE observed_at = ? ORDER BY category')
		.all(latest.observed_at) as CategoryDailyRow[];
}

export function countReposByCategory(): { category: string; count: number }[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT COALESCE(category, 'other') as category, COUNT(*) as count
			 FROM repos
			 WHERE enriched_at IS NOT NULL AND deleted_at IS NULL
			 GROUP BY COALESCE(category, 'other')
			 ORDER BY count DESC`
		)
		.all() as { category: string; count: number }[];
}

export function saveRepoIntelligence(
	repoId: number,
	data: {
		summary: string;
		category: RepoCategory;
		category_confidence: number;
	}
): void {
	const db = getDb();
	const now = new Date().toISOString();
	db.prepare(
		`UPDATE repos SET
		   summary = ?,
		   summary_generated_at = ?,
		   category = ?,
		   category_confidence = ?,
		   classified_at = ?
		 WHERE id = ?`
	).run(data.summary, now, data.category, data.category_confidence, now, repoId);
}

export function rollupCategoryDailyIfNeeded(): string | null {
	const db = getDb();
	const dayStart = new Date();
	dayStart.setUTCHours(0, 0, 0, 0);
	const observedAt = dayStart.toISOString();

	const existing = db
		.prepare('SELECT 1 FROM repo_category_daily WHERE observed_at = ? LIMIT 1')
		.get(observedAt);
	if (existing) return null;

	const counts = countReposByCategory();
	const total = counts.reduce((sum, row) => sum + row.count, 0);
	if (total === 0) return null;

	upsertCategoryDaily(
		observedAt,
		counts.map((row) => ({
			category: row.category,
			repo_count: row.count,
			pct_of_total: (row.count / total) * 100
		}))
	);
	return observedAt;
}
