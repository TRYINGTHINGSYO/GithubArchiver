import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

export const CURRENT_SCHEMA_VERSION = 12;

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

function getSchemaVersion(database: Database.Database): number {
	const row = database.prepare('SELECT MAX(version) as v FROM schema_version').get() as
		| { v: number | null }
		| undefined;
	return row?.v ?? 0;
}

function columnNames(database: Database.Database, table: string): Set<string> {
	const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
	return new Set(columns.map((c) => c.name));
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
	12: migration012
};

export function runMigrations(database: Database.Database) {
	database.exec(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		);
	`);

	let version = getSchemaVersion(database);

	while (version < CURRENT_SCHEMA_VERSION) {
		const next = version + 1;
		const migrate = MIGRATIONS[next];
		if (!migrate) {
			throw new Error(`Missing migration for schema version ${next}`);
		}
		migrate(database);
		database
			.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
			.run(next, new Date().toISOString());
		version = next;
	}
}
