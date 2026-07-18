import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { CLUSTER_DEFINITIONS } from '$lib/server/cluster-registry';

export const CURRENT_SCHEMA_VERSION = 32;

const ENRICHMENT_COLUMNS = [
	'default_branch TEXT',
	'description TEXT',
	'language TEXT',
	'stars INTEGER',
	'forks INTEGER',
	'watchers INTEGER',
	'license TEXT',
	'topics TEXT',
	'pushed_at TEXT',
	'updated_at TEXT',
	'enriched_at TEXT',
	'deleted_at TEXT',
	'github_archived INTEGER NOT NULL DEFAULT 0'
] as const;

export function getSchemaVersion(database: Database.Database): number {
	const row = database.prepare('SELECT MAX(version) as v FROM schema_version').get() as
		| { v: number | null }
		| undefined;
	return row?.v ?? 0;
}

export function columnNames(database: Database.Database, table: string): Set<string> {
	const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
	return new Set(columns.map((c) => c.name));
}

export function hasRepoColumn(database: Database.Database, column: string): boolean {
	return columnNames(database, 'repos').has(column);
}

function migration001(database: Database.Database) {
	const repoCols = columnNames(database, 'repos');

	if (repoCols.size > 0 && !repoCols.has('github_url')) {
		database.exec(`
			DROP TABLE IF EXISTS star_snapshots;
			DROP TABLE IF EXISTS archive_snapshots;
			DROP TABLE IF EXISTS ingestion_state;
			DROP TABLE IF EXISTS repos;
		`);
	}

	database.exec(`
		CREATE TABLE IF NOT EXISTS repos (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			owner TEXT NOT NULL,
			name TEXT NOT NULL,
			full_name TEXT NOT NULL UNIQUE,
			github_url TEXT NOT NULL,
			event_id TEXT NOT NULL,
			created_at TEXT NOT NULL,
			first_seen_at TEXT NOT NULL
		);
	`);

	const cols = columnNames(database, 'repos');
	for (const def of ENRICHMENT_COLUMNS) {
		const name = def.split(' ')[0];
		if (!cols.has(name)) {
			database.exec(`ALTER TABLE repos ADD COLUMN ${def}`);
		}
	}

	database.exec(`
		CREATE INDEX IF NOT EXISTS idx_repos_first_seen_at ON repos(first_seen_at DESC);
		CREATE INDEX IF NOT EXISTS idx_repos_created_at ON repos(created_at DESC);
		CREATE INDEX IF NOT EXISTS idx_repos_language ON repos(language);
		CREATE INDEX IF NOT EXISTS idx_repos_enriched_at ON repos(enriched_at);
		CREATE INDEX IF NOT EXISTS idx_repos_deleted_at ON repos(deleted_at DESC);

		CREATE TABLE IF NOT EXISTS archive_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			repo_id INTEGER NOT NULL,
			snapshot_type TEXT NOT NULL,
			file_path TEXT NOT NULL,
			file_size INTEGER NOT NULL,
			sha256 TEXT NOT NULL,
			head_sha TEXT,
			archived_at TEXT NOT NULL,
			FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_archive_snapshots_repo ON archive_snapshots(repo_id, archived_at DESC);

		CREATE TABLE IF NOT EXISTS repository_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			repo_id INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			event_time TEXT NOT NULL,
			payload_json TEXT NOT NULL DEFAULT '{}',
			FOREIGN KEY (repo_id) REFERENCES repos(id)
		);

		CREATE INDEX IF NOT EXISTS idx_repository_events_repo ON repository_events(repo_id, event_time DESC);
		CREATE INDEX IF NOT EXISTS idx_repository_events_time ON repository_events(event_time DESC);
		CREATE INDEX IF NOT EXISTS idx_repository_events_type ON repository_events(event_type, event_time DESC);

		CREATE TABLE IF NOT EXISTS repo_aliases (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			repo_id INTEGER NOT NULL,
			old_full_name TEXT NOT NULL UNIQUE,
			new_full_name TEXT NOT NULL,
			renamed_at TEXT NOT NULL,
			FOREIGN KEY (repo_id) REFERENCES repos(id)
		);

		CREATE INDEX IF NOT EXISTS idx_repo_aliases_repo ON repo_aliases(repo_id);

		CREATE TABLE IF NOT EXISTS releases (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			repo_id INTEGER NOT NULL,
			github_release_id INTEGER,
			tag TEXT NOT NULL,
			name TEXT,
			published_at TEXT,
			prerelease INTEGER NOT NULL DEFAULT 0,
			draft INTEGER NOT NULL DEFAULT 0,
			body TEXT,
			tarball_url TEXT,
			zipball_url TEXT,
			first_seen_at TEXT NOT NULL,
			UNIQUE(repo_id, tag),
			FOREIGN KEY (repo_id) REFERENCES repos(id)
		);

		CREATE INDEX IF NOT EXISTS idx_releases_repo ON releases(repo_id, published_at DESC);
		CREATE INDEX IF NOT EXISTS idx_releases_published ON releases(published_at DESC);

		CREATE TABLE IF NOT EXISTS release_assets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			release_id INTEGER NOT NULL,
			github_asset_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			size INTEGER NOT NULL DEFAULT 0,
			download_count INTEGER NOT NULL DEFAULT 0,
			content_type TEXT,
			browser_download_url TEXT,
			UNIQUE(release_id, github_asset_id),
			FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
		);
	`);
}

function migration002(database: Database.Database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS ingestion_state (
			hour_key TEXT PRIMARY KEY,
			ingested_at TEXT NOT NULL,
			events INTEGER NOT NULL DEFAULT 0,
			inserted INTEGER NOT NULL DEFAULT 0,
			skipped INTEGER NOT NULL DEFAULT 0
		);

		CREATE INDEX IF NOT EXISTS idx_ingestion_state_ingested_at ON ingestion_state(ingested_at DESC);

		CREATE TABLE IF NOT EXISTS job_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			job_type TEXT NOT NULL,
			status TEXT NOT NULL,
			started_at TEXT NOT NULL,
			finished_at TEXT,
			detail_json TEXT NOT NULL DEFAULT '{}',
			error TEXT
		);

		CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at DESC);
		CREATE INDEX IF NOT EXISTS idx_job_runs_type_started ON job_runs(job_type, started_at DESC);
	`);
}

function migration003(database: Database.Database) {
	const repoCols = columnNames(database, 'repos');
	const extraCols = [
		'last_checked_at TEXT',
		'open_issues INTEGER',
		'size INTEGER'
	] as const;

	for (const def of extraCols) {
		const name = def.split(' ')[0];
		if (!repoCols.has(name)) {
			database.exec(`ALTER TABLE repos ADD COLUMN ${def}`);
		}
	}

	database.exec(`
		CREATE TABLE IF NOT EXISTS repo_metrics_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			repo_id INTEGER NOT NULL,
			stars INTEGER NOT NULL,
			forks INTEGER NOT NULL,
			watchers INTEGER NOT NULL,
			open_issues INTEGER NOT NULL,
			size INTEGER NOT NULL,
			captured_at TEXT NOT NULL,
			FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_repo_metrics_repo ON repo_metrics_snapshots(repo_id, captured_at DESC);
		CREATE INDEX IF NOT EXISTS idx_repo_metrics_captured ON repo_metrics_snapshots(captured_at DESC);
	`);
}

function migration004(database: Database.Database) {
	const repoCols = columnNames(database, 'repos');
	if (!repoCols.has('discovery_source')) {
		database.exec(`ALTER TABLE repos ADD COLUMN discovery_source TEXT NOT NULL DEFAULT 'gharchive'`);
	}

	const ingestCols = columnNames(database, 'ingestion_state');
	if (ingestCols.size > 0 && !ingestCols.has('source')) {
		database.exec(`ALTER TABLE ingestion_state ADD COLUMN source TEXT NOT NULL DEFAULT 'gharchive'`);
	}
}

function migration005(database: Database.Database) {
	const repoCols = columnNames(database, 'repos');
	const refreshCols = ['last_checked_at TEXT', 'open_issues INTEGER', 'size INTEGER'] as const;
	for (const def of refreshCols) {
		const name = def.split(' ')[0];
		if (!repoCols.has(name)) {
			database.exec(`ALTER TABLE repos ADD COLUMN ${def}`);
		}
	}

	database.exec(`
		CREATE TABLE IF NOT EXISTS repo_metrics_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			repo_id INTEGER NOT NULL,
			stars INTEGER NOT NULL,
			forks INTEGER NOT NULL,
			watchers INTEGER NOT NULL,
			open_issues INTEGER NOT NULL,
			size INTEGER NOT NULL,
			captured_at TEXT NOT NULL,
			FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_repo_metrics_repo ON repo_metrics_snapshots(repo_id, captured_at DESC);
		CREATE INDEX IF NOT EXISTS idx_repo_metrics_captured ON repo_metrics_snapshots(captured_at DESC);
		CREATE INDEX IF NOT EXISTS idx_repos_last_checked_at ON repos(last_checked_at);

		UPDATE repos
		SET last_checked_at = enriched_at
		WHERE enriched_at IS NOT NULL AND last_checked_at IS NULL;
	`);
}

function migration006(database: Database.Database) {
	database.exec(`
		CREATE VIRTUAL TABLE IF NOT EXISTS repos_fts USING fts5(
			full_name,
			owner,
			name,
			description,
			language,
			license,
			topics,
			readme_text,
			repo_id UNINDEXED,
			tokenize='porter unicode61'
		);
	`);

	const repos = database.prepare('SELECT * FROM repos').all() as {
		id: number;
		owner: string;
		name: string;
		full_name: string;
		description: string | null;
		language: string | null;
		license: string | null;
		topics: string | null;
	}[];

	const insert = database.prepare(
		`INSERT INTO repos_fts
		 (full_name, owner, name, description, language, license, topics, readme_text, repo_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);

	for (const repo of repos) {
		let topics = '';
		if (repo.topics) {
			try {
				topics = (JSON.parse(repo.topics) as string[]).join(' ');
			} catch {
				topics = '';
			}
		}

		let readmeText = '';
		const readmeRow = database
			.prepare(
				`SELECT file_path FROM archive_snapshots
				 WHERE repo_id = ? AND snapshot_type = 'readme'
				 ORDER BY archived_at DESC LIMIT 1`
			)
			.get(repo.id) as { file_path: string } | undefined;
		if (readmeRow?.file_path) {
			try {
				readmeText = readFileSync(readmeRow.file_path, 'utf8').slice(0, 50_000);
			} catch {
				readmeText = '';
			}
		}

		database.prepare('DELETE FROM repos_fts WHERE repo_id = ?').run(repo.id);
		insert.run(
			repo.full_name,
			repo.owner,
			repo.name,
			repo.description ?? '',
			repo.language ?? '',
			repo.license ?? '',
			topics,
			readmeText,
			repo.id
		);
	}
}

function migration007(database: Database.Database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS backfill_jobs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			start_date TEXT NOT NULL,
			end_date TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'auto',
			max_hours_per_run INTEGER NOT NULL DEFAULT 6,
			status TEXT NOT NULL DEFAULT 'pending',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			last_error TEXT
		);

		CREATE TABLE IF NOT EXISTS backfill_hours (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			job_id INTEGER NOT NULL,
			hour_key TEXT NOT NULL,
			year INTEGER NOT NULL,
			date TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			source TEXT,
			events_parsed INTEGER NOT NULL DEFAULT 0,
			repos_inserted INTEGER NOT NULL DEFAULT 0,
			error TEXT,
			updated_at TEXT NOT NULL,
			UNIQUE(job_id, hour_key),
			FOREIGN KEY (job_id) REFERENCES backfill_jobs(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_backfill_hours_job_status ON backfill_hours(job_id, status);
		CREATE INDEX IF NOT EXISTS idx_backfill_hours_date ON backfill_hours(date);
		CREATE INDEX IF NOT EXISTS idx_repos_first_seen_year ON repos(first_seen_at);
	`);
}

function migration008(database: Database.Database) {
	const repoCols = columnNames(database, 'repos');
	const profileCols = [
		'homepage TEXT',
		'visibility TEXT',
		'owner_avatar_url TEXT',
		'owner_type TEXT'
	] as const;

	for (const def of profileCols) {
		const name = def.split(' ')[0];
		if (!repoCols.has(name)) {
			database.exec(`ALTER TABLE repos ADD COLUMN ${def}`);
		}
	}

	database.exec(`
		CREATE INDEX IF NOT EXISTS idx_repos_owner_type ON repos(owner_type);
	`);
}

function migration009(database: Database.Database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS search_ingest_stats (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			hour_key TEXT NOT NULL,
			query TEXT NOT NULL,
			shard_depth INTEGER NOT NULL DEFAULT 0,
			shard_minutes INTEGER,
			total_count INTEGER,
			incomplete_results INTEGER NOT NULL DEFAULT 0,
			pages_fetched INTEGER NOT NULL DEFAULT 0,
			found INTEGER NOT NULL DEFAULT 0,
			inserted INTEGER NOT NULL DEFAULT 0,
			skipped INTEGER NOT NULL DEFAULT 0,
			source TEXT NOT NULL DEFAULT 'github_search',
			status TEXT NOT NULL DEFAULT 'running',
			started_at TEXT NOT NULL,
			finished_at TEXT,
			error TEXT
		);

		CREATE INDEX IF NOT EXISTS idx_search_ingest_hour ON search_ingest_stats(hour_key);
		CREATE INDEX IF NOT EXISTS idx_search_ingest_started ON search_ingest_stats(started_at DESC);
		CREATE INDEX IF NOT EXISTS idx_search_ingest_status ON search_ingest_stats(status);
	`);
}

function migration010(database: Database.Database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS repo_commit_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			repo_id INTEGER NOT NULL,
			sha TEXT NOT NULL,
			tree_sha TEXT,
			parent_sha TEXT,
			committed_at TEXT,
			author_name TEXT,
			author_email TEXT,
			default_branch TEXT NOT NULL,
			observed_at TEXT NOT NULL,
			FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_repo_commit_snapshots_repo_observed
			ON repo_commit_snapshots(repo_id, observed_at DESC);

		CREATE INDEX IF NOT EXISTS idx_repo_commit_snapshots_repo_sha
			ON repo_commit_snapshots(repo_id, sha);

		CREATE TABLE IF NOT EXISTS repo_license_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			repo_id INTEGER NOT NULL,
			license TEXT,
			observed_at TEXT NOT NULL,
			FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_repo_license_history_repo_observed
			ON repo_license_history(repo_id, observed_at DESC);

		CREATE TABLE IF NOT EXISTS repo_topics_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			repo_id INTEGER NOT NULL,
			topics_json TEXT NOT NULL,
			added_json TEXT,
			removed_json TEXT,
			observed_at TEXT NOT NULL,
			FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_repo_topics_history_repo_observed
			ON repo_topics_history(repo_id, observed_at DESC);
	`);
}

function migration011(database: Database.Database) {
	const jobCols = columnNames(database, 'job_runs');
	if (!jobCols.has('reason')) {
		database.exec('ALTER TABLE job_runs ADD COLUMN reason TEXT');
	}

	const repoCols = columnNames(database, 'repos');
	for (const def of [
		'summary TEXT',
		'summary_generated_at TEXT',
		'category TEXT',
		'category_confidence REAL',
		'classified_at TEXT'
	]) {
		const name = def.split(' ')[0];
		if (!repoCols.has(name)) {
			database.exec(`ALTER TABLE repos ADD COLUMN ${def}`);
		}
	}

	const archiveCols = columnNames(database, 'archive_snapshots');
	if (!archiveCols.has('capture_reason')) {
		database.exec(
			`ALTER TABLE archive_snapshots ADD COLUMN capture_reason TEXT NOT NULL DEFAULT 'daemon'`
		);
	}

	database.exec(`
		CREATE INDEX IF NOT EXISTS idx_job_runs_reason ON job_runs(reason)
		  WHERE reason IS NOT NULL;

		CREATE INDEX IF NOT EXISTS idx_repos_category ON repos(category);
		CREATE INDEX IF NOT EXISTS idx_repos_classified_at ON repos(classified_at);

		CREATE INDEX IF NOT EXISTS idx_archive_snapshots_capture
		  ON archive_snapshots(repo_id, snapshot_type, capture_reason, archived_at DESC);

		CREATE TABLE IF NOT EXISTS repo_category_daily (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			observed_at TEXT NOT NULL,
			category TEXT NOT NULL,
			repo_count INTEGER NOT NULL,
			pct_of_total REAL NOT NULL,
			UNIQUE(observed_at, category)
		);

		CREATE INDEX IF NOT EXISTS idx_repo_category_daily_observed
		  ON repo_category_daily(observed_at DESC);

		CREATE TABLE IF NOT EXISTS daemon_decisions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			decided_at TEXT NOT NULL,
			action TEXT NOT NULL,
			reason TEXT NOT NULL,
			backlog_json TEXT NOT NULL DEFAULT '{}',
			job_run_id INTEGER REFERENCES job_runs(id)
		);

		CREATE INDEX IF NOT EXISTS idx_daemon_decisions_at ON daemon_decisions(decided_at DESC);
	`);
}

function migration012(database: Database.Database) {
	const ingestCols = columnNames(database, 'ingestion_state');
	if (!ingestCols.has('unavailable_at')) {
		database.exec(`ALTER TABLE ingestion_state ADD COLUMN unavailable_at TEXT`);
	}
	if (!ingestCols.has('http_status')) {
		database.exec(`ALTER TABLE ingestion_state ADD COLUMN http_status INTEGER`);
	}
}

function migration013(database: Database.Database) {
	database.exec(`
		CREATE INDEX IF NOT EXISTS idx_archive_snapshots_zip
		  ON archive_snapshots(repo_id, archived_at DESC)
		  WHERE snapshot_type = 'zip';
	`);
}

function migration014(database: Database.Database) {
	const repoCols = columnNames(database, 'repos');
	for (const def of [
		'interesting_score REAL',
		'signal_tier TEXT',
		'scored_at TEXT'
	]) {
		const name = def.split(' ')[0];
		if (!repoCols.has(name)) {
			database.exec(`ALTER TABLE repos ADD COLUMN ${def}`);
		}
	}

	database.exec(`
		CREATE INDEX IF NOT EXISTS idx_repos_interesting_score
		  ON repos(interesting_score DESC)
		  WHERE interesting_score IS NOT NULL;

		CREATE INDEX IF NOT EXISTS idx_repos_signal_tier
		  ON repos(signal_tier)
		  WHERE signal_tier IS NOT NULL;
	`);
}

function migration015(database: Database.Database) {
	const repoCols = columnNames(database, 'repos');
	for (const def of ['cluster_version INTEGER', 'clustered_at TEXT']) {
		const name = def.split(' ')[0];
		if (!repoCols.has(name)) {
			database.exec(`ALTER TABLE repos ADD COLUMN ${def}`);
		}
	}

	database.exec(`
		CREATE TABLE IF NOT EXISTS repo_clusters (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			slug TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			description TEXT,
			cluster_type TEXT NOT NULL DEFAULT 'curated',
			repo_count INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS repository_cluster_memberships (
			repository_id INTEGER NOT NULL,
			cluster_id INTEGER NOT NULL,
			confidence REAL NOT NULL,
			evidence_json TEXT NOT NULL DEFAULT '{}',
			clustered_at TEXT NOT NULL,
			PRIMARY KEY (repository_id, cluster_id),
			FOREIGN KEY (repository_id) REFERENCES repos(id) ON DELETE CASCADE,
			FOREIGN KEY (cluster_id) REFERENCES repo_clusters(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_cluster_memberships_cluster
		  ON repository_cluster_memberships(cluster_id, confidence DESC);

		CREATE INDEX IF NOT EXISTS idx_cluster_memberships_repo
		  ON repository_cluster_memberships(repository_id);

		CREATE INDEX IF NOT EXISTS idx_repos_cluster_version
		  ON repos(cluster_version)
		  WHERE cluster_version IS NOT NULL;
	`);

	const now = new Date().toISOString();
	const seedCluster = database.prepare(
		`INSERT INTO repo_clusters (slug, name, description, cluster_type, repo_count, created_at, updated_at)
		 VALUES (?, ?, ?, 'curated', 0, ?, ?)
		 ON CONFLICT(slug) DO UPDATE SET
		   name = excluded.name,
		   description = excluded.description,
		   updated_at = excluded.updated_at`
	);
	for (const def of CLUSTER_DEFINITIONS) {
		seedCluster.run(def.slug, def.name, def.description ?? null, now, now);
	}
}

function migration016(database: Database.Database) {
	const repoCols = columnNames(database, 'repos');
	for (const def of [
		'story_facts_json TEXT',
		'story_text TEXT',
		'story_version INTEGER',
		'story_generated_at TEXT'
	]) {
		const name = def.split(' ')[0];
		if (!repoCols.has(name)) {
			database.exec(`ALTER TABLE repos ADD COLUMN ${def}`);
		}
	}

	database.exec(`
		CREATE INDEX IF NOT EXISTS idx_repos_story_version
		  ON repos(story_version)
		  WHERE story_version IS NOT NULL;
	`);
}

function migration017(database: Database.Database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS emerging_topics (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			key TEXT NOT NULL,
			label TEXT NOT NULL,
			candidate_type TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'detected',
			period_start TEXT NOT NULL,
			period_end TEXT NOT NULL,
			current_count INTEGER NOT NULL,
			previous_count INTEGER NOT NULL,
			distinct_owner_count INTEGER NOT NULL,
			average_interesting_score REAL,
			novelty_score REAL NOT NULL,
			momentum_score REAL NOT NULL,
			quality_score REAL NOT NULL,
			emerging_score REAL NOT NULL,
			evidence_json TEXT NOT NULL,
			detection_version INTEGER NOT NULL,
			generated_at TEXT NOT NULL,
			UNIQUE(key, period_start, detection_version)
		);

		CREATE INDEX IF NOT EXISTS idx_emerging_topics_period_score
		  ON emerging_topics(period_start DESC, emerging_score DESC);

		CREATE INDEX IF NOT EXISTS idx_emerging_topics_status
		  ON emerging_topics(status, period_start DESC);

		CREATE TABLE IF NOT EXISTS emerging_topic_repositories (
			emerging_topic_id INTEGER NOT NULL,
			repository_id INTEGER NOT NULL,
			relevance REAL NOT NULL,
			evidence_json TEXT,
			PRIMARY KEY (emerging_topic_id, repository_id),
			FOREIGN KEY (emerging_topic_id) REFERENCES emerging_topics(id) ON DELETE CASCADE,
			FOREIGN KEY (repository_id) REFERENCES repos(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_emerging_topic_repos_repo
		  ON emerging_topic_repositories(repository_id);
	`);
}

function migration018(database: Database.Database) {
	const topicCols = columnNames(database, 'emerging_topics');
	for (const def of ['review_reason TEXT', 'reviewed_at TEXT', 'history_json TEXT']) {
		const name = def.split(' ')[0];
		if (!topicCols.has(name)) {
			database.exec(`ALTER TABLE emerging_topics ADD COLUMN ${def}`);
		}
	}

	database.exec(`
		CREATE TABLE IF NOT EXISTS emerging_term_aliases (
			alias TEXT PRIMARY KEY,
			canonical_key TEXT NOT NULL,
			created_at TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_emerging_aliases_canonical
		  ON emerging_term_aliases(canonical_key);

		CREATE TABLE IF NOT EXISTS emerging_term_exclusions (
			term TEXT PRIMARY KEY,
			reason TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
	`);
}

function migration019(database: Database.Database) {
	const repoCols = columnNames(database, 'repos');
	if (!repoCols.has('enrichment_level')) {
		database.exec(`ALTER TABLE repos ADD COLUMN enrichment_level INTEGER NOT NULL DEFAULT 0`);
	}

	database.exec(`
		UPDATE repos
		SET enrichment_level = 1
		WHERE enriched_at IS NOT NULL AND enrichment_level < 1;

		UPDATE repos
		SET enrichment_level = MAX(enrichment_level, 2)
		WHERE id IN (
			SELECT DISTINCT repo_id FROM archive_snapshots WHERE snapshot_type = 'readme'
		);

		UPDATE repos
		SET enrichment_level = MAX(enrichment_level, 3)
		WHERE id IN (
			SELECT DISTINCT repo_id FROM archive_snapshots
			WHERE snapshot_type IN ('source', 'zip')
		);

		CREATE INDEX IF NOT EXISTS idx_repos_enrichment_level
		  ON repos(enrichment_level);

		CREATE INDEX IF NOT EXISTS idx_repos_unenriched_priority
		  ON repos(created_at DESC)
		  WHERE enriched_at IS NULL AND deleted_at IS NULL;

		CREATE TABLE IF NOT EXISTS repo_pipeline_queue (
			repository_id INTEGER PRIMARY KEY,
			needs_classification INTEGER NOT NULL DEFAULT 0,
			needs_scoring INTEGER NOT NULL DEFAULT 0,
			needs_clustering INTEGER NOT NULL DEFAULT 0,
			needs_story INTEGER NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (repository_id) REFERENCES repos(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_repo_pipeline_clustering
		  ON repo_pipeline_queue(needs_clustering)
		  WHERE needs_clustering = 1;

		CREATE INDEX IF NOT EXISTS idx_repo_pipeline_story
		  ON repo_pipeline_queue(needs_story)
		  WHERE needs_story = 1;
	`);
}

function migration020(database: Database.Database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS emerging_detection_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			period_start TEXT NOT NULL,
			period_end TEXT NOT NULL,
			detection_version INTEGER NOT NULL,
			candidates_detected INTEGER NOT NULL DEFAULT 0,
			growth_suppressed_reason TEXT,
			current_window_json TEXT NOT NULL,
			previous_window_json TEXT NOT NULL,
			generated_at TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_emerging_detection_runs_period
		  ON emerging_detection_runs(period_start DESC, generated_at DESC);
	`);
}

function migration021(database: Database.Database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS backfill_dataset_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source TEXT NOT NULL DEFAULT 'github-search',
			window_start TEXT NOT NULL,
			window_end TEXT NOT NULL,
			query_version INTEGER NOT NULL,
			sharding_version INTEGER NOT NULL,
			deduplication_version INTEGER NOT NULL,
			sampling_version INTEGER NOT NULL,
			max_per_hour INTEGER NOT NULL,
			target_sample_size INTEGER NOT NULL DEFAULT 1500,
			expected_shards INTEGER NOT NULL DEFAULT 0,
			completed_shards INTEGER NOT NULL DEFAULT 0,
			partial_shards INTEGER NOT NULL DEFAULT 0,
			failed_shards INTEGER NOT NULL DEFAULT 0,
			observed_repos INTEGER NOT NULL DEFAULT 0,
			sampled_repos INTEGER NOT NULL DEFAULT 0,
			enriched_repos INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'pending',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			completed_at TEXT
		);

		CREATE INDEX IF NOT EXISTS idx_backfill_dataset_runs_window
		  ON backfill_dataset_runs(window_start, window_end, status);

		CREATE TABLE IF NOT EXISTS backfill_dataset_repositories (
			run_id INTEGER NOT NULL,
			repository_id INTEGER NOT NULL,
			time_bucket TEXT NOT NULL,
			sample_rank INTEGER,
			inclusion_reason TEXT NOT NULL,
			PRIMARY KEY (run_id, repository_id),
			FOREIGN KEY (run_id) REFERENCES backfill_dataset_runs(id) ON DELETE CASCADE,
			FOREIGN KEY (repository_id) REFERENCES repos(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_backfill_dataset_repos_bucket
		  ON backfill_dataset_repositories(run_id, time_bucket);

		CREATE TABLE IF NOT EXISTS backfill_dataset_shards (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL,
			time_bucket TEXT NOT NULL,
			shard_key TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			found INTEGER NOT NULL DEFAULT 0,
			inserted INTEGER NOT NULL DEFAULT 0,
			incomplete INTEGER NOT NULL DEFAULT 0,
			error TEXT,
			updated_at TEXT NOT NULL,
			UNIQUE(run_id, time_bucket, shard_key),
			FOREIGN KEY (run_id) REFERENCES backfill_dataset_runs(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_backfill_dataset_shards_run
		  ON backfill_dataset_shards(run_id, status);
	`);

	const detectionCols = columnNames(database, 'emerging_detection_runs');
	if (!detectionCols.has('current_dataset_id')) {
		database.exec(`ALTER TABLE emerging_detection_runs ADD COLUMN current_dataset_id INTEGER`);
	}
	if (!detectionCols.has('previous_dataset_id')) {
		database.exec(`ALTER TABLE emerging_detection_runs ADD COLUMN previous_dataset_id INTEGER`);
	}
}

function migration022(database: Database.Database) {
	const cols = columnNames(database, 'backfill_dataset_runs');
	if (!cols.has('target_sample_size')) {
		database.exec(
			`ALTER TABLE backfill_dataset_runs ADD COLUMN target_sample_size INTEGER NOT NULL DEFAULT 1500`
		);
	}
}

function migration023(database: Database.Database) {
	const cols = columnNames(database, 'backfill_dataset_runs');
	if (!cols.has('comparison_mode')) {
		database.exec(
			`ALTER TABLE backfill_dataset_runs ADD COLUMN comparison_mode TEXT NOT NULL DEFAULT 'absolute'`
		);
	}
	if (!cols.has('matched_hour_offsets_json')) {
		database.exec(
			`ALTER TABLE backfill_dataset_runs ADD COLUMN matched_hour_offsets_json TEXT NOT NULL DEFAULT '[]'`
		);
	}
	if (!cols.has('paired_run_id')) {
		database.exec(`ALTER TABLE backfill_dataset_runs ADD COLUMN paired_run_id INTEGER`);
	}
}

function migration024(database: Database.Database) {
	const cols = columnNames(database, 'backfill_dataset_runs');
	if (!cols.has('construction_version')) {
		database.exec(
			`ALTER TABLE backfill_dataset_runs ADD COLUMN construction_version INTEGER NOT NULL DEFAULT 1`
		);
	}
	if (!cols.has('candidate_pool_size')) {
		database.exec(
			`ALTER TABLE backfill_dataset_runs ADD COLUMN candidate_pool_size INTEGER NOT NULL DEFAULT 100`
		);
	}
}

function migration025(database: Database.Database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS repo_favorites (
			repo_id INTEGER PRIMARY KEY,
			favorited_at TEXT NOT NULL,
			FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_repo_favorites_at
		  ON repo_favorites(favorited_at DESC);
	`);
}

function migration026(database: Database.Database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS scheduled_jobs (
			job_name TEXT PRIMARY KEY,
			last_started_at TEXT,
			last_completed_at TEXT,
			next_run_at TEXT,
			status TEXT,
			last_error TEXT,
			consecutive_failures INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS discovery_projects_to_watch (
			rank INTEGER NOT NULL,
			tier TEXT NOT NULL,
			repo_id INTEGER NOT NULL,
			discovery_score REAL NOT NULL DEFAULT 0,
			payload_json TEXT NOT NULL,
			materialized_at TEXT NOT NULL,
			PRIMARY KEY (tier, rank)
		);

		CREATE TABLE IF NOT EXISTS discovery_emerging_topics (
			rank INTEGER NOT NULL PRIMARY KEY,
			tier TEXT NOT NULL,
			topic_key TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			materialized_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS discovery_fastest_clusters (
			rank INTEGER NOT NULL PRIMARY KEY,
			tier TEXT NOT NULL,
			cluster_slug TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			materialized_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS discovery_deleted_preserved (
			rank INTEGER NOT NULL PRIMARY KEY,
			tier TEXT NOT NULL,
			repo_id INTEGER NOT NULL,
			preservation_score REAL NOT NULL DEFAULT 0,
			payload_json TEXT NOT NULL,
			materialized_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS discovery_unusual_finds (
			rank INTEGER NOT NULL PRIMARY KEY,
			tier TEXT NOT NULL,
			repo_id INTEGER NOT NULL,
			payload_json TEXT NOT NULL,
			materialized_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS discovery_system_status (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			repositories_discovered INTEGER NOT NULL DEFAULT 0,
			enriched INTEGER NOT NULL DEFAULT 0,
			classified INTEGER NOT NULL DEFAULT 0,
			clustered INTEGER NOT NULL DEFAULT 0,
			last_ingestion_at TEXT,
			last_discovery_analysis_at TEXT,
			last_emerging_analysis_at TEXT,
			worker_status TEXT NOT NULL DEFAULT 'unknown',
			updated_at TEXT NOT NULL
		);

		INSERT OR IGNORE INTO discovery_system_status (id, updated_at)
		VALUES (1, datetime('now'));
	`);
}

function migration027(database: Database.Database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS worker_progress (
			worker_name TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			current_item TEXT,
			completed INTEGER NOT NULL DEFAULT 0,
			failed INTEGER NOT NULL DEFAULT 0,
			remaining INTEGER NOT NULL DEFAULT 0,
			total INTEGER NOT NULL DEFAULT 0,
			enriched_total INTEGER NOT NULL DEFAULT 0,
			detail_json TEXT NOT NULL DEFAULT '{}',
			updated_at TEXT NOT NULL
		);
	`);
}

function migration028(database: Database.Database) {
	const cols = columnNames(database, 'repos');
	const additions = [
		"enrichment_status TEXT NOT NULL DEFAULT 'pending'",
		'enrichment_priority REAL NOT NULL DEFAULT 0',
		"enrichment_tier TEXT NOT NULL DEFAULT 'normal'",
		"enrichment_depth TEXT NOT NULL DEFAULT 'none'",
		'next_enrichment_at TEXT',
		'enrichment_attempts INTEGER NOT NULL DEFAULT 0',
		'last_enrichment_error TEXT',
		'enrichment_claimed_by TEXT',
		'enrichment_claimed_at TEXT',
		'enrichment_claim_expires_at TEXT',
		'enrichment_etag TEXT',
		'last_enrichment_http_status INTEGER'
	] as const;

	for (const def of additions) {
		const name = def.split(' ')[0];
		if (!cols.has(name)) {
			database.exec(`ALTER TABLE repos ADD COLUMN ${def}`);
		}
	}

	database.exec(`
		UPDATE repos SET
		  enrichment_status = CASE
		    WHEN deleted_at IS NOT NULL THEN 'unavailable'
		    WHEN enriched_at IS NOT NULL THEN 'done'
		    ELSE 'pending'
		  END,
		  enrichment_depth = CASE
		    WHEN enrichment_level >= 2 THEN 'deep'
		    WHEN enriched_at IS NOT NULL THEN 'fast'
		    ELSE 'none'
		  END,
		  enrichment_priority = CASE
		    WHEN enriched_at IS NOT NULL THEN 0
		    ELSE (
		      COALESCE(stars, 0) * 12.0 +
		      COALESCE(forks, 0) * 4.0 +
		      CASE WHEN created_at >= datetime('now', '-7 days') THEN 80
		           WHEN created_at >= datetime('now', '-30 days') THEN 45
		           WHEN created_at >= datetime('now', '-90 days') THEN 20
		           ELSE 0 END +
		      CASE WHEN description IS NOT NULL AND length(trim(description)) >= 20 THEN 15 ELSE 0 END +
		      CASE WHEN language IS NOT NULL AND language != '' THEN 10 ELSE 0 END +
		      CASE WHEN topics IS NOT NULL AND topics != '[]' AND topics != '' THEN 12 ELSE 0 END
		    )
		  END,
		  enrichment_tier = CASE
		    WHEN enriched_at IS NOT NULL THEN 'normal'
		    WHEN COALESCE(stars, 0) >= 50 OR created_at >= datetime('now', '-3 days') THEN 'urgent'
		    WHEN COALESCE(stars, 0) >= 10 OR created_at >= datetime('now', '-14 days') THEN 'high'
		    WHEN created_at < datetime('now', '-365 days') AND COALESCE(stars, 0) = 0 THEN 'deferred'
		    WHEN created_at < datetime('now', '-180 days') AND COALESCE(stars, 0) < 2 THEN 'low'
		    ELSE 'normal'
		  END,
		  next_enrichment_at = CASE
		    WHEN enriched_at IS NOT NULL THEN NULL
		    WHEN deleted_at IS NOT NULL THEN NULL
		    ELSE datetime('now')
		  END
		WHERE enrichment_status = 'pending' OR enrichment_priority = 0 OR next_enrichment_at IS NULL;

		CREATE TABLE IF NOT EXISTS worker_leases (
			lease_name TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			acquired_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			heartbeat_at TEXT NOT NULL,
			detail_json TEXT NOT NULL DEFAULT '{}'
		);

		CREATE TABLE IF NOT EXISTS enrichment_metrics (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			cycle_started_at TEXT,
			cycle_finished_at TEXT,
			enriched_fast INTEGER NOT NULL DEFAULT 0,
			enriched_deep INTEGER NOT NULL DEFAULT 0,
			failed INTEGER NOT NULL DEFAULT 0,
			requests INTEGER NOT NULL DEFAULT 0,
			avg_latency_ms REAL NOT NULL DEFAULT 0,
			concurrency INTEGER NOT NULL DEFAULT 0,
			quota_remaining INTEGER,
			quota_reset_at TEXT,
			throughput_per_min REAL NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL
		);

		INSERT OR IGNORE INTO enrichment_metrics (id, updated_at)
		VALUES (1, datetime('now'));

		CREATE INDEX IF NOT EXISTS idx_repos_enrich_queue
		  ON repos(enrichment_tier, enrichment_priority DESC, next_enrichment_at)
		  WHERE enriched_at IS NULL AND deleted_at IS NULL;

		CREATE INDEX IF NOT EXISTS idx_repos_enrichment_status
		  ON repos(enrichment_status);

		CREATE INDEX IF NOT EXISTS idx_repos_enrichment_tier
		  ON repos(enrichment_tier);

		CREATE INDEX IF NOT EXISTS idx_repos_enrichment_priority
		  ON repos(enrichment_priority DESC);

		CREATE INDEX IF NOT EXISTS idx_repos_next_enrichment_at
		  ON repos(next_enrichment_at);

		CREATE INDEX IF NOT EXISTS idx_repos_enrichment_depth
		  ON repos(enrichment_depth);

		CREATE INDEX IF NOT EXISTS idx_repos_claim_expires
		  ON repos(enrichment_claim_expires_at);
	`);
}

/** Normalize ISO-8601 (with T/Z) to a SQLite-friendly datetime for julianday(). */
const SQL_TS = (column: string) =>
	`julianday(replace(substr(replace(COALESCE(${column}, ''), 'Z', ''), 1, 19), 'T', ' '))`;

/**
 * Recompute enrichment tiers for the unenriched backlog.
 * v28 marked nearly every CreateEvent as urgent via `created_at >= datetime('now', '-3 days')`.
 * v29/v30 still promoted recently-*seen* repos to high, which flooded the queue after bulk ingest.
 * v31 tiers by created_at (+ stars/signal), and defers old zero-signal long-tail.
 * v32 defers empty CreateEvent spam (zero stars / no description) — the live backlog
 * is almost entirely repos created in the last few days, so age-deferral never fires.
 */
export function recomputeEnrichmentTiersSql(database: Database.Database): void {
	const createdAge = `(julianday('now') - ${SQL_TS('created_at')})`;
	const seenAge = `(julianday('now') - ${SQL_TS('first_seen_at')})`;
	const hasDesc = `(description IS NOT NULL AND length(trim(description)) >= 20)`;

	database.exec(`
		UPDATE repos SET
		  enrichment_priority = CASE
		    WHEN enriched_at IS NOT NULL THEN 0
		    ELSE (
		      COALESCE(stars, 0) * 12.0 +
		      COALESCE(forks, 0) * 4.0 +
		      CASE WHEN ${createdAge} <= 3 THEN 20
		           WHEN ${createdAge} <= 14 THEN 12
		           WHEN ${createdAge} <= 45 THEN 8
		           WHEN ${createdAge} >= 365 THEN -20
		           ELSE 0 END +
		      CASE WHEN ${seenAge} <= 1 AND ${createdAge} <= 30 THEN 10 ELSE 0 END +
		      CASE WHEN ${hasDesc} THEN 15 ELSE 0 END +
		      CASE WHEN language IS NOT NULL AND language != '' THEN 10 ELSE 0 END +
		      CASE WHEN topics IS NOT NULL AND topics != '[]' AND topics != '' THEN 12 ELSE 0 END
		    )
		  END,
		  enrichment_tier = CASE
		    WHEN enriched_at IS NOT NULL THEN 'normal'
		    WHEN COALESCE(stars, 0) >= 50 THEN 'urgent'
		    WHEN COALESCE(stars, 0) >= 5 AND ${createdAge} <= 3 THEN 'urgent'
		    WHEN COALESCE(stars, 0) >= 10 THEN 'high'
		    WHEN COALESCE(stars, 0) >= 1 AND ${createdAge} <= 14 THEN 'high'
		    WHEN ${hasDesc} AND ${createdAge} <= 14 THEN 'high'
		    WHEN COALESCE(stars, 0) = 0 AND NOT ${hasDesc} THEN 'deferred'
		    WHEN ${createdAge} >= 180 AND COALESCE(stars, 0) < 2 THEN 'deferred'
		    WHEN COALESCE(stars, 0) < 2 AND NOT ${hasDesc} THEN 'low'
		    ELSE 'normal'
		  END,
		  enrichment_status = CASE
		    WHEN deleted_at IS NOT NULL THEN 'unavailable'
		    WHEN enriched_at IS NOT NULL THEN 'done'
		    WHEN COALESCE(stars, 0) = 0 AND NOT ${hasDesc} THEN 'deferred'
		    WHEN ${createdAge} >= 180 AND COALESCE(stars, 0) < 2 THEN 'deferred'
		    WHEN enrichment_status IN ('claimed', 'forbidden', 'terminal', 'unavailable') THEN enrichment_status
		    ELSE 'pending'
		  END,
		  next_enrichment_at = CASE
		    WHEN enriched_at IS NOT NULL THEN NULL
		    WHEN deleted_at IS NOT NULL THEN NULL
		    WHEN COALESCE(stars, 0) = 0 AND NOT ${hasDesc} THEN datetime('now', '+7 days')
		    WHEN ${createdAge} >= 180 AND COALESCE(stars, 0) < 2 THEN datetime('now', '+7 days')
		    ELSE COALESCE(next_enrichment_at, datetime('now'))
		  END
		WHERE enriched_at IS NULL;
	`);
}

function migration029(database: Database.Database) {
	recomputeEnrichmentTiersSql(database);
}

/**
 * Persist matched repository-create count separately from `events`.
 * `events` has been overloaded (parsed totals vs creates+searchFound), which made
 * search-gap logic unsafe. `matched_repo_creates` is the only signal that means
 * GH Archive matcher found repository births.
 */
function migration030(database: Database.Database) {
	const cols = columnNames(database, 'ingestion_state');
	if (!cols.has('matched_repo_creates')) {
		database.exec(
			`ALTER TABLE ingestion_state ADD COLUMN matched_repo_creates INTEGER NOT NULL DEFAULT 0`
		);
	}
}

/** Fix bulk-ingest tier flood: stop promoting recently-seen old repos to high. */
function migration031(database: Database.Database) {
	recomputeEnrichmentTiersSql(database);
}

/** Defer empty CreateEvent spam — live backlog is nearly all <7d-old creates. */
function migration032(database: Database.Database) {
	recomputeEnrichmentTiersSql(database);
}

const MIGRATIONS: Record<number, (db: Database.Database) => void> = {
	1: migration001,
	2: migration002,
	3: migration003,
	4: migration004,
	5: migration005,
	6: migration006,
	7: migration007,
	8: migration008,
	9: migration009,
	10: migration010,
	11: migration011,
	12: migration012,
	13: migration013,
	14: migration014,
	15: migration015,
	16: migration016,
	17: migration017,
	18: migration018,
	19: migration019,
	20: migration020,
	21: migration021,
	22: migration022,
	23: migration023,
	24: migration024,
	25: migration025,
	26: migration026,
	27: migration027,
	28: migration028,
	29: migration029,
	30: migration030,
	31: migration031,
	32: migration032
};

export interface MigrationRunResult {
	before: number;
	after: number;
	applied: number[];
}

/**
 * Apply migrations in order up to `targetVersion` (inclusive).
 * Used by production migrate and by tests that need a frozen pre-014 schema.
 */
export function runMigrationsThrough(
	database: Database.Database,
	targetVersion: number
): MigrationRunResult {
	if (targetVersion < 0 || targetVersion > CURRENT_SCHEMA_VERSION) {
		throw new Error(`targetVersion must be between 0 and ${CURRENT_SCHEMA_VERSION}`);
	}

	database.exec(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		);
	`);

	const before = getSchemaVersion(database);
	let version = before;
	const applied: number[] = [];

	while (version < targetVersion) {
		const next = version + 1;
		const migrate = MIGRATIONS[next];
		if (!migrate) {
			throw new Error(`Missing migration for schema version ${next}`);
		}
		migrate(database);
		database
			.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
			.run(next, new Date().toISOString());
		applied.push(next);
		version = next;
	}

	return { before, after: version, applied };
}

export function runMigrations(database: Database.Database): MigrationRunResult {
	return runMigrationsThrough(database, CURRENT_SCHEMA_VERSION);
}

/**
 * Repair known production drift where schema_version advanced without DDL
 * (e.g. repos.interesting_score missing while version >= 14).
 * Each repair is idempotent.
 */
export function repairSchemaDrift(database: Database.Database): string[] {
	const repairs: string[] = [];
	const repoCols = columnNames(database, 'repos');

	if (
		!repoCols.has('interesting_score') ||
		!repoCols.has('signal_tier') ||
		!repoCols.has('scored_at')
	) {
		migration014(database);
		repairs.push('014:repos.interesting_score');
	}

	const refreshed = columnNames(database, 'repos');
	if (!refreshed.has('cluster_version') || !refreshed.has('clustered_at')) {
		migration015(database);
		repairs.push('015:repos.cluster_columns');
	}

	const tables = new Set(
		(
			database
				.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
				.all() as { name: string }[]
		).map((row) => row.name)
	);
	if (!tables.has('repo_clusters') || !tables.has('repository_cluster_memberships')) {
		migration015(database);
		if (!repairs.includes('015:repos.cluster_columns')) {
			repairs.push('015:cluster_tables');
		}
	}

	return repairs;
}
