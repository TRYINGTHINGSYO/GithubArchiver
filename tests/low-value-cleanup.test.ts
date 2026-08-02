import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { CURRENT_SCHEMA_VERSION, getSchemaVersion } from '$lib/server/db/schema';
import { setRepoFavorite } from '$lib/server/db/favorites';
import {
	addRepositoryToCollection,
	getOrCreateSystemCollection
} from '$lib/server/db/collections';
import {
	previewLowValueCleanup,
	purgeQuarantinedRepos,
	quarantineLowValueRepos,
	restoreQuarantinedRepos,
	setCleanupProtected
} from '$lib/server/low-value-cleanup';
import { createTestRepo, setupTestDb, teardownTestDb } from './helpers/db';

function ageRepo(repoId: number, createdAt: string): void {
	getDb()
		.prepare('UPDATE repos SET created_at = ?, first_seen_at = ?, pushed_at = ? WHERE id = ?')
		.run(createdAt, createdAt, createdAt, repoId);
}

function clearEnrichmentSignals(repoId: number): void {
	getDb()
		.prepare(
			`UPDATE repos SET
				stars = 0,
				forks = 0,
				description = NULL,
				homepage = NULL,
				language = NULL,
				topics = NULL,
				size = 0,
				interesting_score = NULL,
				enriched_at = NULL,
				enrichment_level = 0
			 WHERE id = ?`
		)
		.run(repoId);
}

describe('low-value repository cleanup', () => {
	beforeEach(() => {
		setupTestDb();
		expect(getSchemaVersion(getDb())).toBe(CURRENT_SCHEMA_VERSION);
		expect(CURRENT_SCHEMA_VERSION).toBe(46);
	});

	afterEach(() => teardownTestDb());

	it('does not match young zero-star repos (emerging protection)', () => {
		const repo = createTestRepo();
		clearEnrichmentSignals(repo.id);
		ageRepo(repo.id, new Date().toISOString());

		const preview = previewLowValueCleanup({ preset: 'balanced', sampleSize: 20 });
		expect(preview.match_count).toBe(0);
	});

	it('matches old empty zero-engagement repos under balanced preset', () => {
		const repo = createTestRepo();
		clearEnrichmentSignals(repo.id);
		ageRepo(repo.id, '2026-01-01T00:00:00.000Z');

		const preview = previewLowValueCleanup({ preset: 'balanced', sampleSize: 20 });
		expect(preview.match_count).toBe(1);
		expect(preview.samples[0]?.full_name).toBe(repo.full_name);
	});

	it('protects favorites, watch later, and cleanup_protected repos', () => {
		const favorite = createTestRepo();
		const watchLater = createTestRepo();
		const protectedRepo = createTestRepo();
		const junk = createTestRepo();

		for (const repo of [favorite, watchLater, protectedRepo, junk]) {
			clearEnrichmentSignals(repo.id);
			ageRepo(repo.id, '2026-01-01T00:00:00.000Z');
		}

		setRepoFavorite(favorite.id, true);
		const owner = {
			owner_type: 'anonymous' as const,
			owner_key: 'anon:11111111-1111-4111-8111-111111111111'
		};
		getOrCreateSystemCollection(owner, 'watch_later');
		addRepositoryToCollection(owner, 'watch_later', watchLater.id);
		setCleanupProtected(protectedRepo.id, true);

		const preview = previewLowValueCleanup({ preset: 'balanced', sampleSize: 20 });
		expect(preview.match_count).toBe(1);
		expect(preview.samples.map((sample) => sample.id)).toEqual([junk.id]);
	});

	it('does not match repos that have a release or homepage', () => {
		const withHomepage = createTestRepo();
		const withRelease = createTestRepo();
		clearEnrichmentSignals(withHomepage.id);
		clearEnrichmentSignals(withRelease.id);
		ageRepo(withHomepage.id, '2026-01-01T00:00:00.000Z');
		ageRepo(withRelease.id, '2026-01-01T00:00:00.000Z');

		getDb()
			.prepare('UPDATE repos SET homepage = ? WHERE id = ?')
			.run('https://example.com', withHomepage.id);
		getDb()
			.prepare(
				`INSERT INTO releases (repo_id, tag, first_seen_at)
				 VALUES (?, 'v1.0.0', ?)`
			)
			.run(withRelease.id, '2026-01-02T00:00:00.000Z');

		const preview = previewLowValueCleanup({ preset: 'balanced', sampleSize: 20 });
		expect(preview.match_count).toBe(0);
	});

	it('quarantines matches, hides them from default queries, then purges after force', () => {
		const repo = createTestRepo();
		clearEnrichmentSignals(repo.id);
		ageRepo(repo.id, '2026-01-01T00:00:00.000Z');

		const quarantined = quarantineLowValueRepos({ preset: 'balanced', sampleSize: 10 });
		expect(quarantined.affected).toBe(1);

		const row = getDb()
			.prepare('SELECT pending_deletion_at, cleanup_reason FROM repos WHERE id = ?')
			.get(repo.id) as { pending_deletion_at: string; cleanup_reason: string };
		expect(row.pending_deletion_at).toBeTruthy();
		expect(row.cleanup_reason).toContain('balanced');

		const visible = getDb()
			.prepare('SELECT COUNT(*) AS c FROM repos WHERE pending_deletion_at IS NULL')
			.get() as { c: number };
		expect(visible.c).toBe(0);

		const restored = restoreQuarantinedRepos({ ids: [repo.id] });
		expect(restored.affected).toBe(1);

		quarantineLowValueRepos({ preset: 'balanced' });
		const purged = purgeQuarantinedRepos({ forcePurge: true, rebuildFts: false });
		expect(purged.affected).toBe(1);
		expect(
			(getDb().prepare('SELECT COUNT(*) AS c FROM repos').get() as { c: number }).c
		).toBe(0);
		expect(
			(
				getDb().prepare('SELECT COUNT(*) AS c FROM repository_events').get() as {
					c: number;
				}
			).c
		).toBe(0);
	});

	it('safe preset targets confirmed deleted repos without touching active junk', () => {
		const deleted = createTestRepo();
		const activeJunk = createTestRepo();
		clearEnrichmentSignals(deleted.id);
		clearEnrichmentSignals(activeJunk.id);
		ageRepo(deleted.id, '2026-01-01T00:00:00.000Z');
		ageRepo(activeJunk.id, '2026-01-01T00:00:00.000Z');
		getDb()
			.prepare('UPDATE repos SET deleted_at = ? WHERE id = ?')
			.run('2026-01-15T00:00:00.000Z', deleted.id);

		const preview = previewLowValueCleanup({ preset: 'safe', sampleSize: 20 });
		expect(preview.match_count).toBe(1);
		expect(preview.samples[0]?.id).toBe(deleted.id);
	});
});
