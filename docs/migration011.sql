-- migration011 — v11-ops autonomous daemon & repo intelligence
-- Canonical SQL reference. Applied via src/lib/server/db/schema.ts migration011().
-- See docs/PROPOSAL-autonomous-intelligence.md

-- 1) Daemon / job observability
ALTER TABLE job_runs ADD COLUMN reason TEXT;

CREATE INDEX IF NOT EXISTS idx_job_runs_reason ON job_runs(reason)
  WHERE reason IS NOT NULL;

-- 2) Repo intelligence (persisted at enrich time)
ALTER TABLE repos ADD COLUMN summary TEXT;
ALTER TABLE repos ADD COLUMN summary_generated_at TEXT;
ALTER TABLE repos ADD COLUMN category TEXT;
ALTER TABLE repos ADD COLUMN category_confidence REAL;
ALTER TABLE repos ADD COLUMN classified_at TEXT;

CREATE INDEX IF NOT EXISTS idx_repos_category ON repos(category);
CREATE INDEX IF NOT EXISTS idx_repos_classified_at ON repos(classified_at);

-- 3) Snapshot provenance (daemon vs on-demand export)
ALTER TABLE archive_snapshots ADD COLUMN capture_reason TEXT NOT NULL DEFAULT 'daemon';

CREATE INDEX IF NOT EXISTS idx_archive_snapshots_capture
  ON archive_snapshots(repo_id, snapshot_type, capture_reason, archived_at DESC);

-- 4) Category distribution history (append-only, for gap detection)
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

-- 5) Daemon decision log
CREATE TABLE IF NOT EXISTS daemon_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decided_at TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  backlog_json TEXT NOT NULL DEFAULT '{}',
  job_run_id INTEGER REFERENCES job_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_daemon_decisions_at ON daemon_decisions(decided_at DESC);
