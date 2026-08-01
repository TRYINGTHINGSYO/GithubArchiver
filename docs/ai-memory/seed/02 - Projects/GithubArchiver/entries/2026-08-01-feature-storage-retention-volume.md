---
id: feature-storage-retention-volume
date: 2026-08-01
area:
  - storage
  - sqlite
  - ops
  - railway
type: feature
status: open
confidence: confirmed
durability: permanent
schema: 1
migration: 42
relationships: []
title: Volume retention, dbstat inventory, and github_id uniqueness
---

## What

Least-disruption storage hygiene for the Railway SQLite volume:

1. Migration **042** adds nullable `repos.github_id`, unique partial index on `github_id`, and case-insensitive owner/name unique index when no conflicts exist.
2. Ingest (GH Archive `repo.id`) and enrichment (GitHub API `id`) persist `github_id`.
3. `/admin/storage` reports database file/WAL size, `dbstat` object sizes, row counts, duplicate `github_id` / owner-name groups, backup usage, and retention preview.
4. Retention policies prune aged `job_runs`, collapse/age `repo_metrics_snapshots`, delete high-churn `repository_events`, and rotate on-volume backups (7 daily / 4 weekly / 3 monthly).
5. Admin actions: apply retention + optional `VACUUM` (needs free disk space).
6. Backup runs auto-prune older backups; disk-pressure recovery also applies retention (without VACUUM).

## Why

Append-only metadata (events, metrics, job JSON, backups) grows the single `/data/githubarchive.db` volume even when repository rows are not duplicated. Operators need inventory before deletes and safe retention defaults before migrating to Postgres / object storage.

## Tests

- `tests/migration-042-github-id.test.ts`
- `tests/retention.test.ts`
- `tests/ingest-commit.test.ts` (github_id persisted)

## Ops notes

- Confirm Railway env: `ENABLE_ARTIFACT_ARCHIVE` unset/0, `DATABASE_PATH=/data/githubarchive.db`, `BACKUPS_DIR=/data/backups`.
- Live-resize the volume before VACUUM on a nearly-full disk.
- Deduplicate by `github_id` first; do not blind-delete by owner/name (renames / reuse).
- Postgres + R2/S3 for backups/artifacts remain the long-term split; not in this change.
