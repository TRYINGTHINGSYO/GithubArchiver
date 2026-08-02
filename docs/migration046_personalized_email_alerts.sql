-- Migration 046: opt-in personalized repository email alerts.

CREATE TABLE IF NOT EXISTS user_email_preferences (
    user_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    minimum_score REAL NOT NULL DEFAULT 55 CHECK (minimum_score >= 0 AND minimum_score <= 100),
    last_digest_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_email_preferences_enabled
ON user_email_preferences(enabled, last_digest_at);

CREATE TABLE IF NOT EXISTS personalized_email_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    repo_id INTEGER NOT NULL,
    digest_key TEXT NOT NULL,
    provider_message_id TEXT,
    sent_at TEXT NOT NULL,
    UNIQUE(user_id, repo_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_personalized_email_deliveries_user_sent
ON personalized_email_deliveries(user_id, sent_at DESC);
