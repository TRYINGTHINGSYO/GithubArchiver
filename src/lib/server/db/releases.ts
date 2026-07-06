import { getDb } from './connection';
import type { ReleaseAssetRow, ReleaseInput, ReleaseRow } from './types';

export function insertReleaseIfNew(repoId: number, release: ReleaseInput): number | null {
	const database = getDb();
	const existing = database
		.prepare('SELECT id FROM releases WHERE repo_id = ? AND tag = ?')
		.get(repoId, release.tag) as { id: number } | undefined;
	if (existing) return null;

	const now = new Date().toISOString();
	const result = database
		.prepare(
			`INSERT INTO releases
			 (repo_id, github_release_id, tag, name, published_at, prerelease, draft, body, tarball_url, zipball_url, first_seen_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			repoId,
			release.github_release_id,
			release.tag,
			release.name,
			release.published_at,
			release.prerelease ? 1 : 0,
			release.draft ? 1 : 0,
			release.body,
			release.tarball_url,
			release.zipball_url,
			now
		);

	const releaseId = Number(result.lastInsertRowid);
	for (const asset of release.assets) {
		database
			.prepare(
				`INSERT OR IGNORE INTO release_assets
				 (release_id, github_asset_id, name, size, download_count, content_type, browser_download_url)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				releaseId,
				asset.github_asset_id,
				asset.name,
				asset.size,
				asset.download_count,
				asset.content_type,
				asset.browser_download_url
			);
	}
	return releaseId;
}

export function listLatestReleases(limit = 50): (ReleaseRow & {
	owner: string;
	name: string;
	full_name: string;
})[] {
	const database = getDb();
	return database
		.prepare(
			`SELECT rl.*, r.owner, r.name, r.full_name
			 FROM releases rl
			 JOIN repos r ON r.id = rl.repo_id
			 ORDER BY COALESCE(rl.published_at, rl.first_seen_at) DESC
			 LIMIT ?`
		)
		.all(limit) as (ReleaseRow & { owner: string; name: string; full_name: string })[];
}

export function listRepoReleases(repoId: number): ReleaseRow[] {
	const database = getDb();
	return database
		.prepare(
			`SELECT * FROM releases WHERE repo_id = ? ORDER BY COALESCE(published_at, first_seen_at) DESC`
		)
		.all(repoId) as ReleaseRow[];
}

export function listRepoReleaseAssets(repoId: number): ReleaseAssetRow[] {
	const database = getDb();
	return database
		.prepare(
			`SELECT a.*
			 FROM release_assets a
			 JOIN releases r ON r.id = a.release_id
			 WHERE r.repo_id = ?
			 ORDER BY a.download_count DESC, a.size DESC`
		)
		.all(repoId) as ReleaseAssetRow[];
}
