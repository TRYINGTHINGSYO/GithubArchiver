# GithubArchive+

An append-only metadata intelligence layer for GitHub repositories — ingest from [GH Archive](https://www.gharchive.org/) and GitHub Search, save lightweight repo records such as names, links, stars, languages, releases, and events, then refresh richer GitHub details on demand when people open a repository.

**Live:** [new-production-9120.up.railway.app](https://new-production-9120.up.railway.app)  
**Repo:** [github.com/TRYINGTHINGSYO/GithubArchiver](https://github.com/TRYINGTHINGSYO/GithubArchiver)

---

## What it does

```
GH Archive (.json.gz)          GitHub Search API
        │                              │
        └──────────┬───────────────────┘
                   ▼
            SQLite (repos, events, FTS)
                   │
         GitHub API (enrich / refresh)
                   ▼
        Metadata intelligence + metrics
                   │
                   ▼
         SvelteKit UI + REST API
```

- **Discover** new repos from hourly GH Archive CreateEvents, with GitHub Search fallback when the archive is empty or unavailable
- **Shard** search queries (hour → 15 min → 5 min → 1 min) when `total_count > 1000`
- **Enrich** metadata, releases, rename/delete detection
- **Store lightweight metadata by default**: repo names, GitHub links, stars, languages, descriptions, events, releases, summaries, and metrics
- **Refresh on click**: repo pages can call GitHub for fresh metadata without storing source artifacts
- **Optionally archive artifacts** only when `ENABLE_ARTIFACT_ARCHIVE=1`
- **Favorite** important repos globally so storage cleanup protects their preserved artifacts
- **Browse** search, feeds, timelines, birth feed, and per-repo detail pages
- **Operate** entirely from the browser via `/admin` — no SSH or terminal required in production

### Metadata-first mode

GithubArchive+ now defaults to metadata-only storage. It keeps discovery, GitHub Search ingest, GH Archive ingest, enrichment, metrics snapshots, repository events, releases, summaries, categories, Archive Pulse, feeds, and repository intelligence running, but it does not download or store README snapshots, source tarballs, ZIP exports, or archived file contents.

This lets Railway run safely without large artifact storage. The durable record is the repo name, GitHub URL, stars, metadata, metrics, releases, and history. Richer details are refreshed from GitHub when users open repos. To restore the older artifact archive behavior, set `ENABLE_ARTIFACT_ARCHIVE=1`.

---

## Quick start (local)

```bash
npm install
cp .env.example .env          # add GITHUB_TOKEN (public_repo scope)
npm run db:init
npm run dev                   # http://localhost:5173
```

Open **[/admin](http://localhost:5173/admin)** and click **GitHub Search Ingest** or **Start Auto-Scan**.

Or run workers manually:

```bash
npm run ingest:hour
npm run enrich:repos
npm run enrich:refresh
```

Workers load `.env` automatically via `scripts/load-env.ts`.

### Windows desktop

Double-click `start-githubarchive.bat` to install deps, run `db:init`, start the dev server, and open `/admin`.  
Use `stop-githubarchive.bat` to stop the server. See [docs/LOCAL_DESKTOP.md](docs/LOCAL_DESKTOP.md).

---

## Admin (browser control center)

All operations run **in-process** inside the web server and are recorded in `job_runs` for recall.

Admin routes and repo mutation actions require the shared admin login. Set `ADMIN_PASSWORD` in production; if it is not set, the default password is `GitHub`. Favorites are global across the site, not account-specific.

| Tab | URL | Purpose |
|-----|-----|---------|
| **Control** | `/admin` | Auto-scan, search ingest, pipeline, enrich, refresh, backup, backfill |
| **Job history** | `/admin/jobs` | View past runs with full stored JSON results |
| **Health** | `/admin/doctor` | DB/FTS/snapshot checks; one-click repairs |
| **Storage** | `/admin/storage` | Disk usage, duplicates, orphan cleanup |

### Control panel actions

| Button | What it does |
|--------|----------------|
| **Start Auto-Scan** | Continuous ingest → enrich → refresh loop; archive is skipped unless artifact storage is enabled |
| **GitHub Search Ingest** | Discover repos for the current hour via Search API |
| **Ingest Missing Hours** | Backfill any GH Archive hours not yet ingested |
| **Full Pipeline** | One-shot ingest + enrich + refresh; archive is skipped unless artifact storage is enabled |
| **Enrich / Refresh** | Run a single worker batch |
| **Create Backup** | SQLite + manifest backup to `BACKUPS_DIR` |
| **Start backfill** | Resumable date-range backfill with progress bar |

`/admin/status` redirects to `/admin`.

On **Railway**, auto-scan starts automatically on deploy (`BACKGROUND_WORKER=auto`).

---

## Railway deployment

The repo includes a `Dockerfile` and `railway.toml`. Connect the GitHub repo to Railway and attach a **volume** mounted at `/data`.

### Required environment variables

```
DATA_DIR=/data
DATABASE_PATH=/data/githubarchive.db
ARCHIVE_DIR=/data/archives
BACKUPS_DIR=/data/backups
GITHUB_TOKEN=ghp_...          # public_repo scope only
ADMIN_PASSWORD=change-me      # default is GitHub if omitted
```

### Optional

```
BACKGROUND_WORKER=auto        # default on Railway; set 0 to disable auto-scan
PORT=8080                     # Railway sets this automatically
STORAGE_MIN_FREE_BYTES=1073741824
ENABLE_ARTIFACT_ARCHIVE=1     # optional: enable README/source/ZIP artifact storage
```

When free archive volume space falls below `STORAGE_MIN_FREE_BYTES` (default: 1 GiB), archive cycles run storage cleanup before downloading more artifacts. Favorited repositories are protected during this pressure cleanup.

Deploy flow: Docker build (`npm ci` + `npm run build`) → `npm run db:migrate` → `npm run start:server`.  
First deploy typically takes **5–10 minutes** (native `better-sqlite3` compile + SvelteKit build).

---

## Workers (CLI)

| Script | Purpose |
|--------|---------|
| `ingest:hour` | One GH Archive hour (`GH_ARCHIVE_HOUR` or previous UTC hour) |
| `ingest:today` | All completed UTC hours today |
| `ingest:search` | GitHub Search discovery only (current hour) |
| `enrich:repos` | GitHub metadata for unenriched repos (batch 50) |
| `enrich:refresh` | Re-check enriched repos when `last_checked_at` > 24h |
| `archive:repos` | No-op by default; local README + tarball snapshots only when `ENABLE_ARTIFACT_ARCHIVE=1` |
| `db:init` | Alias for migrate (legacy) |
| `db:migrate` | Apply missing schema migrations (required before serve) |
| `db:status` | Report sanitized DB path, schema version, interesting_score, repo count |
| `daemon` | Continuous ingest → enrich → refresh loop; archive skipped unless artifact storage is enabled |
| `pipeline:once` | Single full cycle (no daemon loop) |
| `backup` / `restore` | Local backup and restore |
| `doctor` | Health checks; optional FTS rebuild / missing snapshot cleanup |
| `storage:analyze` | Archive disk usage, duplicates, cleanup |
| `backfill:day` / `backfill:range` / `backfill:resume` | Resumable historical backfill |

```bash
npm run daemon    # foreground loop; Ctrl+C to stop
```

---

## GitHub Search sharding

When GitHub Search returns `total_count > 1000` for an hour window, the ingestor automatically splits:

1. **1 hour** → 4 × **15-minute** windows  
2. Still > 1000 → 3 × **5-minute** windows  
3. Still > 1000 → 5 × **1-minute** windows  

Each shard fetches up to `SEARCH_MAX_PAGES` pages (100 repos/page). Stats per shard are stored in `search_ingest_stats`. Configure depth with `SEARCH_SHARD_MAX_DEPTH` (default `3`).

---

## Database schema

Migrations are versioned in `schema_version` (current: **v14**).

| Table | Purpose |
|-------|---------|
| `repos` | Core record, enrichment columns, `discovery_source`, `deleted_at` |
| `repos_fts` | FTS5 full-text search |
| `repository_events` | Append-only timeline |
| `archive_snapshots` | Local snapshot metadata |
| `repo_metrics_snapshots` | Historical stars/forks/watchers per refresh |
| `repo_aliases` | Rename history |
| `releases` / `release_assets` | Release and tag records |
| `repo_favorites` | Global protected favorites for storage cleanup |
| `ingestion_state` | Per-hour GH Archive ingest checkpoint |
| `job_runs` | Worker/daemon/maintenance job history |
| `backfill_jobs` / `backfill_hours` | Resumable backfill progress |
| `search_ingest_stats` | Per-shard GitHub Search telemetry |
| `schema_version` | Applied migration versions |

**Local paths:** `./data/githubarchive.db`, `./data/archives/`, `./data/backups/`  
**Railway paths:** `/data/...` (persistent volume)

---

## Browse

| Route | Description |
|-------|-------------|
| `/` | Repo feed — FTS search, filters, sort, live/trending/archive feeds |
| `/birth-feed` | Newest discoveries with filters |
| `/admin` | Control center (see above) |
| `/repo/[owner]/[repo]` | Metadata, README viewer, snapshot downloads |
| `/repo/[owner]/[repo]/timeline` | Event timeline |
| `/repo/[owner]/[repo]/compare-readme` | Compare two README snapshots (`?from=&to=`) |

---

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/repos` | List repos — FTS when `q` set; filters: `year`, `date_from`, `date_to`, `source`, `language`, `min_stars`, `min_forks`, `archived_only`, `has_readme`, `has_release`, `deleted_only`; `sort=`, `page=`, `per_page=10\|25\|50\|75\|100` |
| `GET /api/search` | FTS search (`q` required) |
| `GET /api/birth-feed` | Birth feed JSON |
| `GET /api/events` | Recent `repository_events` |
| `GET /api/trends` | Trending stats |
| `GET /api/releases/latest` | Latest releases across repos |
| `GET /api/snapshots/[id]` | Download archived snapshot (path-safe) |
| `GET /api/repo/[owner]/[repo]/timeline` | Per-repo timeline JSON |
| `GET /api/admin/status` | Daemon, backfill, stats, rate limits, errors |
| `POST /api/admin/daemon` | `{ "action": "start" \| "stop" }` |
| `POST /api/admin/workers` | `{ "action": "pipeline" \| "ingest" \| "ingest-missing" \| "search-ingest" \| "enrich" \| "archive" \| "refresh" \| "backup" }` |
| `GET /api/admin/jobs` | Job history (`?id=`, `?type=`, `?limit=`) |
| `GET /api/admin/backfill` | Backfill jobs + progress |
| `POST /api/admin/backfill` | Create or resume backfill |
| `POST /api/admin/maintenance` | Doctor repairs or storage cleanup |

---

## Environment variables

| Variable | Default | Used by |
|----------|---------|---------|
| `GITHUB_TOKEN` | — | GitHub API (strongly recommended) |
| `DATABASE_PATH` | `./data/githubarchive.db` | SQLite |
| `DATA_DIR` | `./data` | PID/log files, worker output |
| `ARCHIVE_DIR` | `./data/archives` | Snapshot files when artifact storage is enabled |
| `BACKUPS_DIR` | `./data/backups` | Backup output |
| `METADATA_ONLY` | enabled | Legacy flag; metadata-only storage is the default |
| `ENABLE_ARTIFACT_ARCHIVE` | — | Set `1` to opt into README/source/ZIP artifact downloads |
| `ADMIN_PASSWORD` | `GitHub` | Shared admin login password |
| `ADMIN_SESSION_SECRET` | `ADMIN_PASSWORD` | HMAC secret for admin session cookies |
| `STORAGE_MIN_FREE_BYTES` | `1073741824` | Free-space threshold that triggers cleanup before archive downloads |
| `BACKGROUND_WORKER` | `auto` on Railway | In-process auto-scan on boot |
| `SEARCH_SHARD_MAX_DEPTH` | `3` | Search sharding depth |
| `SEARCH_FALLBACK_MIN_EVENTS` | `1000` | Min GH Archive events before search fallback |
| `SEARCH_MAX_PAGES` | `10` | Max pages per search shard |
| `ENRICH_BATCH_SIZE` | `50` | Enrich batch size |
| `REFRESH_INTERVAL_HOURS` | `24` | Re-enrich after this many hours |
| `DAEMON_SLEEP_MIN_MS` | `300000` | Auto-scan min sleep between loops |
| `DAEMON_SLEEP_MAX_MS` | `900000` | Auto-scan max sleep between loops |
| `GH_ARCHIVE_HOUR` | previous UTC hour | `ingest:hour` override |
| `BACKFILL_START` / `BACKFILL_END` | — | Backfill date range |
| `BACKFILL_SOURCE` | `auto` | `auto`, `gharchive`, or `github_search` |

See `.env.example` for the full list.

---

## Backup & restore

```bash
npm run backup
BACKUP_INCLUDE_ARCHIVES=1 BACKUP_COMPRESS=1 npm run backup

RESTORE_BACKUP_PATH=./data/backups/YYYY-MM-DD_HH-mm-ss RESTORE_CONFIRM=1 npm run restore
```

Or use **Create Backup** in `/admin`. See [docs/RESTORE.md](docs/RESTORE.md).

---

## Project layout

```
src/lib/server/
  db/                  # SQLite schema, repos, jobs, backfill, search-ingest stats
  workers/             # ingest, enrich, refresh, archive cycles
  background-daemon.ts # In-process auto-scan loop (production)
  job-runner.ts        # In-process one-shot jobs (admin API)
  admin.ts             # Status aggregation for admin UI
  enrich.ts            # Enrichment orchestration
  archiver.ts          # Snapshot worker
  github.ts            # GitHub REST client
  gharchive.ts         # GH Archive stream parser
  repo-discovery.ts    # GitHub Search + sharding

src/routes/
  admin/               # Control center, job history, doctor, storage
  api/                 # REST endpoints
  birth-feed/          # Discovery feed
  repo/[owner]/[repo]/ # Per-repo pages

scripts/               # CLI worker entry points
tools/gpt-cursor-relay # Local GPT ↔ Cursor Agent CLI middleman
data/                  # SQLite DB, archives, backups (gitignored)
```

### GPT ⇄ Cursor Relay (local)

Autonomous local middleman (persistent memory, live streams, git diff review, safety stops):

```bash
cd tools/gpt-cursor-relay
npm install
cp .env.example .env   # set OPENAI_API_KEY
npm start              # http://127.0.0.1:8787
```

Or from the repo root: `npm run relay`. See [tools/gpt-cursor-relay/README.md](tools/gpt-cursor-relay/README.md).

---

## License

MIT

