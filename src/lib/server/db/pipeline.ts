import { getDb } from './connection';

export type RepositoryPipelineJob = {
	repositoryId: number;
	needsClassification: boolean;
	needsScoring: boolean;
	needsClustering: boolean;
	needsStory: boolean;
};

type QueueRow = {
	needs_classification: number;
	needs_scoring: number;
	needs_clustering: number;
	needs_story: number;
};

function readQueue(repositoryId: number): QueueRow | undefined {
	return getDb()
		.prepare('SELECT * FROM repo_pipeline_queue WHERE repository_id = ?')
		.get(repositoryId) as QueueRow | undefined;
}

function writeQueue(repositoryId: number, flags: QueueRow): void {
	const db = getDb();
	const empty =
		flags.needs_classification === 0 &&
		flags.needs_scoring === 0 &&
		flags.needs_clustering === 0 &&
		flags.needs_story === 0;

	if (empty) {
		db.prepare('DELETE FROM repo_pipeline_queue WHERE repository_id = ?').run(repositoryId);
		return;
	}

	db.prepare(
		`INSERT INTO repo_pipeline_queue (
		   repository_id, needs_classification, needs_scoring, needs_clustering, needs_story, updated_at
		 ) VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(repository_id) DO UPDATE SET
		   needs_classification = excluded.needs_classification,
		   needs_scoring = excluded.needs_scoring,
		   needs_clustering = excluded.needs_clustering,
		   needs_story = excluded.needs_story,
		   updated_at = excluded.updated_at`
	).run(
		repositoryId,
		flags.needs_classification,
		flags.needs_scoring,
		flags.needs_clustering,
		flags.needs_story,
		new Date().toISOString()
	);
}

/** Merge pipeline flags for a repository. Omitted flags keep their existing value. */
export function enqueueRepoPipeline(
	repositoryId: number,
	flags: Partial<Omit<RepositoryPipelineJob, 'repositoryId'>>
): void {
	const existing = readQueue(repositoryId);
	writeQueue(repositoryId, {
		needs_classification:
			flags.needsClassification === undefined
				? (existing?.needs_classification ?? 0)
				: flags.needsClassification
					? 1
					: 0,
		needs_scoring:
			flags.needsScoring === undefined
				? (existing?.needs_scoring ?? 0)
				: flags.needsScoring
					? 1
					: 0,
		needs_clustering:
			flags.needsClustering === undefined
				? (existing?.needs_clustering ?? 0)
				: flags.needsClustering
					? 1
					: 0,
		needs_story:
			flags.needsStory === undefined
				? (existing?.needs_story ?? 0)
				: flags.needsStory
					? 1
					: 0
	});
}

export function listPipelineJobs(
	flag: 'needsClassification' | 'needsScoring' | 'needsClustering' | 'needsStory',
	limit = 500
): RepositoryPipelineJob[] {
	const column =
		flag === 'needsClassification'
			? 'needs_classification'
			: flag === 'needsScoring'
				? 'needs_scoring'
				: flag === 'needsClustering'
					? 'needs_clustering'
					: 'needs_story';
	const rows = getDb()
		.prepare(
			`SELECT repository_id, needs_classification, needs_scoring, needs_clustering, needs_story
			 FROM repo_pipeline_queue
			 WHERE ${column} = 1
			 ORDER BY updated_at ASC
			 LIMIT ?`
		)
		.all(limit) as Array<QueueRow & { repository_id: number }>;

	return rows.map((row) => ({
		repositoryId: row.repository_id,
		needsClassification: row.needs_classification === 1,
		needsScoring: row.needs_scoring === 1,
		needsClustering: row.needs_clustering === 1,
		needsStory: row.needs_story === 1
	}));
}

/** Clear the listed flags (set to false); other flags stay as-is. */
export function markPipelineDone(
	repositoryId: number,
	done: Partial<Omit<RepositoryPipelineJob, 'repositoryId'>>
): void {
	const patch: Partial<Omit<RepositoryPipelineJob, 'repositoryId'>> = {};
	if (done.needsClassification) patch.needsClassification = false;
	if (done.needsScoring) patch.needsScoring = false;
	if (done.needsClustering) patch.needsClustering = false;
	if (done.needsStory) patch.needsStory = false;
	enqueueRepoPipeline(repositoryId, patch);
}

export function setEnrichmentLevel(repositoryId: number, level: number): void {
	getDb()
		.prepare(
			`UPDATE repos
			 SET enrichment_level = MAX(COALESCE(enrichment_level, 0), ?)
			 WHERE id = ?`
		)
		.run(level, repositoryId);
}

export function countReposByEnrichmentLevel(): Record<number, number> {
	const rows = getDb()
		.prepare(
			`SELECT enrichment_level AS level, COUNT(*) AS c
			 FROM repos
			 GROUP BY enrichment_level`
		)
		.all() as { level: number; c: number }[];
	const out: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
	for (const row of rows) out[row.level] = row.c;
	return out;
}
