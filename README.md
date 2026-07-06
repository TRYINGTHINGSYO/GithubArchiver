# GithubArchive+

Append-only local archive for GitHub repositories, built on [GH Archive](https://www.gharchive.org/) hourly event dumps.

## Quick start

```bash
npm install
cp .env.example .env   # add GITHUB_TOKEN for higher API limits
npm run db:init
npm run ingest:hour
npm run enrich:repos
npm run archive:repos
npm run dev            # http://localhost:5173
```

Workers load `.env` automatically via `scripts/load-env.ts`.

## Windows desktop launch

Double-click `start-githubarchive.bat` to install dependencies when needed, run `npm run db:init`, start the Svelte app, and open `http://localhost:5173/admin/status`.

Use `stop-githubarchive.bat` to stop the local server on port 5173. See [docs/LOCAL_DESKTOP.md](docs/LOCAL_DESKTOP.md) for first-time setup, normal use, backup/restore, and backfill warnings.

## Architecture

```
GH Archive (.json.gz)
    → ingest:hour / ingest:today
    → SQLite (repos + repository_events)

GitHub API
    → enrich:repos (metadata, releases, rename/delete detection)
    → archive:repos (README + source tarball snapshots)

SvelteKit UI + REST API
    → browse, search, timeline, feeds
```

### Source layout

```
src/lib/server/
  db/
    connection.ts   # getDb(), WAL SQLite
    schema.ts       # schema_version migrations
    types.ts        # shared row types
    repos.ts        # repo queries + enrichment updates
    archive.ts      # snapshot persistence
    releases.ts     # release/tag storage
    events.ts       # repository_events SQL
    index.ts        # re-exports
  events.ts         # event labels + appendRepoEvent helper
  enrich.ts         # enrichment orchestration
  archiver.ts       # local snapshot worker logic
  github.ts         # GitHub REST client
  gharchive.ts      # GH Archive stream parser
  repos.ts          # UI/API-facing repo service

scripts/
  load-env.ts       # dotenv bootstrap (import first in workers)
  ingest-hour.ts
  ingest-today.ts
  enrich-repos.ts
  archive-repos.ts
  init-db.ts
```

## Workers

| Script | Purpose |
|--------|---------|
| `ingest:hour` | One GH Archive hour (`GH_ARCHIVE_HOUR` or previous UTC hour) |
| `ingest:today` | All completed UTC hours today |
| `ingest:search` | GitHub Search fallback only (test today's hour) |
| `enrich:repos` | GitHub metadata for unenriched repos (batch 50) |
| `enrich:refresh` | Re-check enriched repos when `last_checked_at` >24h; append metric snapshots |
| `archive:repos` | Local README + tarball snapshots for enriched repos |
| `db:init` | Run schema migrations |
| `daemon` | Continuous ingest → enrich → archive loop |
| `backup` | Local SQLite copy + archives manifest + metadata JSON |
| `restore` | Restore from backup folder or `.tar.gz` (requires `RESTORE_CONFIRM=1`) |
| `doctor` | Health checks; optional FTS rebuild / missing snapshot cleanup |
| `storage:analyze` | Archive disk usage, duplicates, cleanup (optional env flags) |
| `pipeline:once` | Single ingest → enrich → archive cycle (no daemon loop) |
| `backfill:day` | Backfill one UTC day (`BACKFILL_DAY`, optional `BACKFILL_SOURCE`) |
| `backfill:range` | Backfill date range (`BACKFILL_START`, `BACKFILL_END`) |
| `backfill:resume` | Resume active or `BACKFILL_JOB_ID` backfill job |

## Daemon

```bash
npm run daemon
```

Runs in the foreground: ingests missing GH Archive hours, enriches unenriched repos, **refreshes stale enriched repos**, archives enriched repos, then sleeps 5–15 minutes (configurable). Graceful shutdown on Ctrl+C. Backoff on failures and GitHub rate limits.

**From the browser:** `/admin/status` has **Start Daemon**, **Stop Daemon**, **Run Pipeline Now**, and one-shot worker buttons — no terminal needed after startup.

Status page: `/admin/status`

Migrations are versioned in `schema_version` (current: **v7**). Tables:

| Table | Purpose |
|-------|---------|
| `repos` | Core record + enrichment columns + `deleted_at` + `last_checked_at` + `discovery_source` |
| `repo_metrics_snapshots` | Historical stars/forks/watchers/open_issues/size per refresh |
| `repos_fts` | FTS5 virtual table for full-text search |
| `repository_events` | Append-only timeline |
| `archive_snapshots` | Local snapshot metadata |
| `repo_aliases` | Rename history (`old_full_name` → repo) |
| `releases` / `release_assets` | Release and tag records |
| `ingestion_state` | Per-hour GH Archive ingest checkpoint |
| `job_runs` | Worker/daemon job history |
| `backfill_jobs` / `backfill_hours` | Resumable all-years backfill progress (hour checkpoints) |
| `schema_version` | Applied migration versions |

Data files: `./data/githubarchive.db`, `./data/archives/`, `./data/backups/`

## Backup

```bash
npm run backup
```

Creates `data/backups/YYYY-MM-DD_HH-mm-ss/` with:

- `githubarchive.db` — SQLite point-in-time copy
- `archives-manifest.json` — file listing of `ARCHIVE_DIR` + snapshot rows
- `metadata.json` — schema version, backup type, counts, paths, backup size

By default archive snapshot **files** are not bundled (manifest only). Options:

```bash
# Full backup — copy data/archives into the backup folder
BACKUP_INCLUDE_ARCHIVES=1 npm run backup

# Compress backup as .tar.gz (works with either type)
BACKUP_COMPRESS=1 npm run backup

# Both
BACKUP_INCLUDE_ARCHIVES=1 BACKUP_COMPRESS=1 npm run backup
```

Status page `/admin/status` shows latest backup time, size, and type (`manifest-only` vs `full`).

## Restore

```bash
# Stop daemon and dev server first
RESTORE_BACKUP_PATH=./data/backups/YYYY-MM-DD_HH-mm-ss RESTORE_CONFIRM=1 npm run restore
```

Supports backup folders and `.tar.gz` files. Creates a pre-restore backup automatically, removes stale WAL/SHM files, restores `archives/` only when present in the backup, and runs `npm run db:init`.

See [docs/RESTORE.md](docs/RESTORE.md) for details.

## Doctor

```bash
npm run doctor
DOCTOR_REBUILD_FTS=1 npm run doctor
DOCTOR_MARK_MISSING_SNAPSHOTS=1 npm run doctor
```

Health page: `/admin/doctor`

| Variable | Effect |
|----------|--------|
| `DOCTOR_REBUILD_FTS` | Reindex all repos into `repos_fts` |
| `DOCTOR_MARK_MISSING_SNAPSHOTS` | Remove `archive_snapshots` rows for missing files |

## Storage

```bash
npm run storage:analyze
STORAGE_DELETE_ORPHANS=1 npm run storage:analyze
STORAGE_DELETE_DUPLICATES=1 npm run storage:analyze
STORAGE_KEEP_LAST_N=5 npm run storage:analyze
```

Storage page: `/admin/storage`

| Variable | Effect |
|----------|--------|
| `STORAGE_DELETE_ORPHANS` | Delete files on disk not referenced by `archive_snapshots` |
| `STORAGE_DELETE_DUPLICATES` | Remove duplicate SHA-256 snapshots (keeps latest README/source) |
| `STORAGE_KEEP_LAST_N` | Trim to N snapshots per repo/type (keeps latest README/source) |

## Environment variables

| Variable | Default | Used by |
|----------|---------|---------|
| `GITHUB_TOKEN` | — | GitHub API (5000 req/hr) |
| `DATABASE_PATH` | `./data/githubarchive.db` | SQLite |
| `ARCHIVE_DIR` | `./data/archives` | Snapshot files |
| `BACKUPS_DIR` | `./data/backups` | Local backup output |
| `BACKUP_INCLUDE_ARCHIVES` | `0` | Copy `ARCHIVE_DIR` into backup (`1` = full backup) |
| `BACKUP_COMPRESS` | `0` | Pack backup as `.tar.gz` (`1` = compressed) |
| `RESTORE_BACKUP_PATH` | — | Backup folder or `.tar.gz` for `npm run restore` |
| `RESTORE_CONFIRM` | — | Set to `1` to run restore after reading warnings |
| `ARCHIVE_MAX_REPOS` | `10` | archive worker |
| `ARCHIVE_MAX_BYTES` | `52428800` | tarball size limit |
| `ARCHIVE_TIMEOUT_MS` | `120000` | download timeout |
| `ARCHIVE_DELAY_MS` | `1000` | delay between archives |
| `ENRICH_BATCH_SIZE` | `50` | enrich worker |
| `ENRICH_DELAY_MS` | `800` | delay between enriches |
| `REFRESH_BATCH_SIZE` | `50` | refresh worker batch |
| `REFRESH_DELAY_MS` | `800` | delay between refreshes |
| `REFRESH_INTERVAL_HOURS` | `24` | refresh when `last_checked_at` older than this |
| `DAEMON_SLEEP_MIN_MS` | `300000` | daemon min sleep between loops |
| `DAEMON_SLEEP_MAX_MS` | `900000` | daemon max sleep between loops |
| `DAEMON_INGEST_MAX_HOURS` | `6` | max hours ingested per daemon cycle |
| `GH_ARCHIVE_HOUR` | previous UTC hour | ingest:hour override |
| `BACKFILL_DAY` | — | single day for `backfill:day` (`YYYY-MM-DD`) |
| `BACKFILL_START` / `BACKFILL_END` | — | date range for `backfill:range` |
| `BACKFILL_SOURCE` | `auto` | `auto`, `gharchive`, or `github_search` |
| `BACKFILL_MAX_HOURS` | `6` | max hours processed per backfill run |
| `BACKFILL_JOB_ID` | — | resume a specific backfill job |

## Browse

- `/` — search (FTS5, all years), filters, sort, activity feeds, pagination
- `/birth-feed` — newest discoveries with same filters/sort
- `/admin/status` — daemon controls, backfill, live job status, stats
- `/repo/[owner]/[repo]` — metadata + archived README viewer + snapshot downloads
- `/repo/[owner]/[repo]/compare-readme` — compare two README snapshots (`?from=&to=`)
- `/repo/[owner]/[repo]/timeline` — event timeline

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/repos` | List repos — FTS when `q` set; filters: `year`, `date_from`, `date_to`, `source`, `language`, `min_stars`, `min_forks`, `archived_only`, `has_readme`, `has_release`, `deleted_only`; sort: `sort=` |
| `GET /api/search` | FTS search (`q` required; same filters/sort as `/api/repos`) |
| `GET /api/birth-feed` | Birth feed JSON (same filters/sort) |
| `GET /api/admin/status` | Daemon, backfill, stats, rate limit, errors |
| `POST /api/admin/daemon` | `{ "action": "start" \| "stop" }` |
| `POST /api/admin/workers` | `{ "action": "pipeline" \| "ingest" \| "enrich" \| "archive" \| "refresh" }` |
| `GET /api/admin/backfill` | List backfill jobs + progress |
| `POST /api/admin/backfill` | Create job `{ startDate, endDate, source, maxHoursPerRun }`; `?resume=1` resumes |
| `GET /api/snapshots/[id]` | Download archived README or source snapshot (path-safe) |
| `GET /api/events` | Recent `repository_events` |
| `GET /api/releases/latest` | Latest releases across all repos |
| `GET /api/repo/[owner]/[repo]/timeline` | Per-repo timeline JSON |

## License

MIT
