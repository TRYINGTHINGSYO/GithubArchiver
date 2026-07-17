import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDataReadiness } from '$lib/server/data-readiness';
import { getDb } from '$lib/server/db/connection';
import { enqueueRepoPipeline, listPipelineJobs, markPipelineDone } from '$lib/server/db/pipeline';
import { insertRepo, listUnenrichedRepos, saveEnrichment } from '$lib/server/db/repos';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/db/schema';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('enrichment readiness and priority', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('applies schema version 19 with enrichment_level and pipeline queue', () => {
		const db = getDb();
		const version = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number })
			.v;
		expect(version).toBe(CURRENT_SCHEMA_VERSION);

		const cols = (db.prepare('PRAGMA table_info(repos)').all() as { name: string }[]).map(
			(col) => col.name
		);
		expect(cols).toContain('enrichment_level');

		const tables = (
			db
				.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
				.all('repo_pipeline_queue') as { name: string }[]
		).map((row) => row.name);
		expect(tables).toContain('repo_pipeline_queue');
	});

	it('prioritizes recent unenriched repositories over older backlog', () => {
		insertBare('old-owner', 'old-repo', '2024-06-15T12:00:00.000Z');
		insertBare('mid-owner', 'mid-repo', '2026-05-01T12:00:00.000Z');
		insertBare('new-owner', 'new-repo', '2026-07-10T12:00:00.000Z');

		const pending = listUnenrichedRepos(10);
		expect(pending.map((repo) => repo.name)).toEqual(['new-repo', 'mid-repo', 'old-repo']);
	});

	it('sets enrichment_level to 1 when Level-1 metadata is saved', () => {
		const inserted = insertBare('acme', 'widget', '2026-07-10T12:00:00.000Z');
		saveEnrichment(inserted.id!, {
			default_branch: 'main',
			description: 'A widget',
			language: 'TypeScript',
			stars: 3,
			forks: 0,
			watchers: 3,
			license: 'MIT',
			topics: ['widgets'],
			pushed_at: '2026-07-10T12:00:00.000Z',
			updated_at: '2026-07-10T12:00:00.000Z'
		});

		const row = getDb()
			.prepare('SELECT enrichment_level, enriched_at FROM repos WHERE id = ?')
			.get(inserted.id) as { enrichment_level: number; enriched_at: string };
		expect(row.enriched_at).toBeTruthy();
		expect(row.enrichment_level).toBe(1);
	});

	it('tracks pipeline jobs for changed repository IDs', () => {
		const inserted = insertBare('acme', 'pipeline-demo', '2026-07-10T12:00:00.000Z');
		enqueueRepoPipeline(inserted.id!, {
			needsClustering: true,
			needsStory: true
		});

		const clustering = listPipelineJobs('needsClustering');
		expect(clustering.some((job) => job.repositoryId === inserted.id)).toBe(true);

		markPipelineDone(inserted.id!, { needsClustering: true });
		expect(listPipelineJobs('needsClustering').some((job) => job.repositoryId === inserted.id)).toBe(
			false
		);
		expect(listPipelineJobs('needsStory').some((job) => job.repositoryId === inserted.id)).toBe(true);
	});

	it('filters unenriched repositories by creation date range', () => {
		insertBare('early-owner', 'early-repo', '2026-06-20T12:00:00.000Z');
		insertBare('target-owner', 'target-repo', '2026-06-25T12:00:00.000Z');
		insertBare('late-owner', 'late-repo', '2026-07-02T12:00:00.000Z');

		const pending = listUnenrichedRepos(10, {
			createdFrom: '2026-06-22T00:00:00.000Z',
			createdTo: '2026-06-29T00:00:00.000Z'
		});
		expect(pending.map((repo) => repo.name)).toEqual(['target-repo']);
	});

	it('reports emerging detection as not ready below thresholds', () => {
		for (let i = 0; i < 5; i++) {
			const inserted = insertBare(`owner-${i}`, `repo-${i}`, '2026-07-10T12:00:00.000Z');
			saveEnrichment(inserted.id!, {
				default_branch: 'main',
				description: `Repo ${i}`,
				language: 'TypeScript',
				stars: 1,
				forks: 0,
				watchers: 1,
				license: null,
				topics: [],
				pushed_at: '2026-07-10T12:00:00.000Z',
				updated_at: '2026-07-10T12:00:00.000Z'
			});
		}

		const readiness = getDataReadiness({
			periodEnd: new Date('2026-07-15T00:00:00.000Z'),
			windowDays: 7
		});
		expect(readiness.currentWindowEnrichedRepos).toBe(5);
		expect(readiness.emergingDetectionReady).toBe(false);
		expect(readiness.readinessReasons.length).toBeGreaterThan(0);
		expect(readiness.readinessReasons.some((reason) => reason.includes('250'))).toBe(true);
	});
});

function insertBare(owner: string, name: string, createdAt: string) {
	return insertRepo({
		owner,
		name,
		full_name: `${owner}/${name}`,
		github_url: `https://github.com/${owner}/${name}`,
		event_id: `${owner}-${name}-${createdAt}`,
		created_at: createdAt,
		first_seen_at: createdAt
	});
}
