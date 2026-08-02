-- Migration 045: Auth.js-compatible GitHub accounts, sessions, roles, and saved repositories.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT COLLATE NOCASE UNIQUE,
    email_verified TEXT,
    image TEXT,
    github_login TEXT COLLATE NOCASE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
    id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at INTEGER,
    token_type TEXT,
    scope TEXT,
    id_token TEXT,
    session_state TEXT,
    PRIMARY KEY (provider, provider_account_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user
ON oauth_accounts(user_id);

CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    session_token TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    expires TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
ON user_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
ON user_sessions(expires);

CREATE TABLE IF NOT EXISTS user_saved_repos (
    user_id TEXT NOT NULL,
    repo_id INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, repo_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_saved_repos_user
ON user_saved_repos(user_id, created_at DESC);
