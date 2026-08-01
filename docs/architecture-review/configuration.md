# Configuration, scripts, and deployment

## Configuration model

Configuration is read directly from `process.env` in many modules at import or call time. `.env.example` documents common settings; CLI scripts load `.env` through `scripts/load-env.ts`. SvelteKit production environment variables are supplied by the container/platform.

There is no centralized typed configuration schema, required-variable validation, secret manager integration, startup configuration report, or rejection of invalid/nonfinite/negative values. Defaults differ between the web worker and legacy CLI in several places.

## Feature flags

There is no formal feature-flag service or typed flag registry. Boolean environment switches act as operational flags: `BACKGROUND_WORKER`, `ARCHIVE_CREATE_ZIP`, backup inclusion/compression, doctor repairs, storage deletions, and restore confirmation. They are process-wide, evaluated inconsistently at import/call time, have no rollout targeting, audit history, or UI provenance, and several destructive flags are undocumented in `.env.example`.

## Environment variables

### Paths, runtime, and platform

| Variable | Source default | Documented? | Use |
|---|---|---|---|
| `DATABASE_PATH` | `./data/githubarchive.db` | Yes | SQLite path |
| `DATA_DIR` | `./data` | No | Logs/PIDs/checkpoints and default export root; Docker sets `/data` |
| `ARCHIVE_DIR` | `./data/archives` | Yes | README/source/ZIP files; Docker sets `/data/archives` |
| `BACKUPS_DIR` | `./data/backups` | Yes | Backup output; Docker sets `/data/backups` |
| `EXPORTS_DIR` | `{DATA_DIR}/exports` | No | Bulk export ZIPs |
| `PORT` | Adapter/runtime; restore check defaults 5173 | Partially | Production Docker sets 3000; restore checks local dev port |
| `HOST` | Adapter default | No | Docker sets `0.0.0.0` |
| `NODE_ENV` | Runtime supplied | No | Docker sets `production` |
| `BACKGROUND_WORKER` | `auto` | No | Enable/disable/auto in-process daemon |
| `RAILWAY_ENVIRONMENT`, `RAILWAY_PROJECT_ID` | Platform supplied | No | Cause auto daemon start |

### GitHub and GH Archive

| Variable | Default | Documented? | Use |
|---|---:|---|---|
| `GITHUB_TOKEN` | Empty | Yes | Bearer token for GitHub API; strongly recommended |
| `GH_ARCHIVE_HOUR` | Previous UTC hour | Commented | CLI ingest/search/inspect target |
| `GHARCHIVE_PUBLISH_GRACE_HOURS` | 3 | No | Exclude recently ended, likely unpublished hours |
| `GHARCHIVE_UNAVAILABLE_COOLDOWN_HOURS` | 6 | No | Retry delay for older unavailable 404 hours |
| `INGEST_RETRY_MAX` | 3 | Yes | Recent-hour retry count |
| `INGEST_RETRY_BASE_MS` | 5,000 | Yes | Exponential retry base |
| `INGEST_RECENT_HOUR_WINDOW` | 3 | Yes | Hours considered recent for retry behavior |
| `SEARCH_FALLBACK_MIN_EVENTS` | 1,000 | Yes | Minimum parsed GH Archive events before zero-create fallback |
| `SEARCH_MAX_PAGES` | 10 | Yes | GitHub Search pages per query |
| `SEARCH_PAGE_DELAY_MS` | 2,000 | Yes | Delay between search pages |
| `SEARCH_SHARD_MAX_DEPTH` | 3 | Yes | Recursive time-window shard depth |

### Archive worker and artifacts

| Variable | Web/source default | `.env.example` | Notes |
|---|---:|---:|---|
| `ARCHIVE_MAX_REPOS` | 50 | 25 | Web worker batch; legacy CLI default is 10 |
| `ARCHIVE_CONCURRENCY` | 5 | 3 | Concurrent archive calls |
| `ARCHIVE_DELAY_MS` | 100 | 300 | Web worker launch delay; CLI default 1,000 |
| `ARCHIVE_MAX_BYTES` | 52,428,800 | 52,428,800 | Compressed download buffer ceiling |
| `ARCHIVE_TIMEOUT_MS` | 120,000 | 120,000 | Per-download timeout |
| `ARCHIVE_CREATE_ZIP` | false | Not listed | `1`/`true` enables ZIP on archive |
| `ARCHIVE_BURST_CYCLES` | 4 | 3 | Max consecutive autonomous archive cycles |
| `ARCHIVE_BURST_BACKLOG_MIN` | 100 | 100 | Backlog required for burst |
| `ARCHIVE_BACKLOG_SLEEP_THRESHOLD` | 1,000 | 1,000 | Backlog that caps daemon sleep |
| `ARCHIVE_BACKLOG_SLEEP_MS` | 60,000 | 60,000 | Capped sleep |
| `SOURCE_ANALYSIS_MAX_BYTES` | 30,000,000 | Not listed | Maximum compressed tarball accepted for analysis |
| `SOURCE_FILE_MAX_BYTES` | 512,000 | Not listed | Text bytes returned by source-content API |

### Enrich, refresh, daemon

| Variable | Default | Documented? | Use |
|---|---:|---|---|
| `ENRICH_BATCH_SIZE` | 50 | Yes | Enrichment cycle size |
| `ENRICH_DELAY_MS` | 800 | Yes | Delay between enrich operations |
| `REFRESH_BATCH_SIZE` | 50 | Yes | Refresh cycle size |
| `REFRESH_DELAY_MS` | 800 | Yes | Delay between refresh operations |
| `REFRESH_INTERVAL_HOURS` | 24 | Yes | Eligibility age and admin calculation |
| `DAEMON_SLEEP_MIN_MS` | 300,000 | Yes | Minimum idle sleep |
| `DAEMON_SLEEP_MAX_MS` | 900,000 | Yes | Maximum idle sleep |
| `DAEMON_BACKOFF_BASE_MS` | 60,000 | Yes | Failure backoff base |
| `DAEMON_BACKOFF_MAX_MS` | 900,000 | Yes | Failure backoff cap |
| `DAEMON_INGEST_MAX_HOURS` | 6 | Yes | Missing-hour batch bound |
| `DAEMON_INGEST_FROM` | unset | Commented | Earliest hour considered by missing backlog |

### Backfill

| Variable | Default | Use |
|---|---:|---|
| `BACKFILL_DAY` | Current UTC date | Day CLI target |
| `BACKFILL_START`, `BACKFILL_END` | Required by range CLI | Date range |
| `BACKFILL_SOURCE` | `auto` | `auto`, `gharchive`, or `github_search` |
| `BACKFILL_MAX_HOURS` | 24 day CLI / 6 range | Hours per invocation |
| `BACKFILL_JOB_ID` | Active job | Resume a specific job |

### Backup, restore, doctor, storage

| Variable | Default | Documented? | Use |
|---|---|---|---|
| `BACKUP_INCLUDE_ARCHIVES` | false | Commented | Full archive copy when truthy |
| `BACKUP_COMPRESS` | false | Commented | Compress backup when truthy |
| `RESTORE_BACKUP_PATH` | Required | Commented | Restore source |
| `RESTORE_CONFIRM` | false | In restore docs | Destructive restore confirmation |
| `DOCTOR_REBUILD_FTS` | false | No | Enable FTS repair in CLI/options |
| `DOCTOR_MARK_MISSING_SNAPSHOTS` | false | No | Record missing-snapshot failures |
| `STORAGE_DELETE_ORPHANS` | false | No | Daemon/CLI cleanup policy |
| `STORAGE_DELETE_DUPLICATES` | false | No | Duplicate cleanup policy |
| `STORAGE_DELETE_ZIPS` | false | No | Delete generated ZIP snapshots |
| `STORAGE_KEEP_LAST_N` | unset | No | Enables old-snapshot trim and retained count |

Truthy flag helpers generally accept values like `1`/`true`; validation behavior is module-specific. Invalid numeric text often becomes `NaN` and is not rejected at startup.

## NPM scripts

| Script | Command/role |
|---|---|
| `dev` | Vite development server |
| `build` | Vite/SvelteKit production build; does not independently type-check |
| `start` | Run adapter-node output in `build` |
| `preview` | Vite preview |
| `db:init` | Open database and apply migrations |
| `ingest:hour`, `ingest:today` | GH Archive ingestion |
| `inspect:hour` | Inspect/match one archive hour without normal pipeline intent |
| `ingest:search` | GitHub Search discovery for an hour |
| `enrich:repos`, `enrich:refresh` | Metadata pipelines |
| `archive:repos` | Archive queue cycle |
| `pipeline:once` | One combined pipeline run |
| `backfill:day`, `backfill:range`, `backfill:resume` | Historical ingest planning/execution |
| `backup`, `restore`, `doctor`, `storage:analyze` | Operations and recovery |
| `daemon` | Legacy external linear daemon, not the autonomous web planner |
| `test`, `test:watch` | Vitest run/watch |

No `typecheck`, `check`, `lint`, `format`, `coverage`, `e2e`, `migrate:status`, or `seed` script exists.

## Svelte, Vite, TypeScript, and test configuration

- SvelteKit uses `adapter-node` with a `$ingest-core` alias into `scripts/lib/ingest-core.ts`.
- Vite has only the SvelteKit plugin; no proxy, bundle analyzer, CSP, or build budget.
- TypeScript extends generated `.svelte-kit/tsconfig.json`, enables strict mode, JS checking, source maps, bundler resolution, JSON modules, and skips library checks.
- Vitest runs Node tests in forks with a single fork, resolving `$lib` and `$ingest-core`. Single-fork mode avoids simultaneous mutation of shared native/database state but reduces parallel test throughput.

## Docker deployment

Build stage and runtime share `node:20-bookworm-slim`. It installs Python, Make, and g++ before `npm ci` so native modules can build, copies source, and runs `npm run build`. Runtime exposes port 3000 and starts with:

`npm run db:init && node build`

The image does not switch to a non-root user, define a container healthcheck itself, use a multi-stage build, remove compilers/dev dependencies from runtime, or declare a volume. It copies the entire context subject to `.dockerignore`, which excludes local data, environment files, generated builds, Git metadata, and dependencies.

## Railway deployment

`railway.toml` selects the Dockerfile builder, uses `/` as health check with a 300-second timeout, restarts on failure up to ten times. It does not declare volume attachment, domain, replicas, CPU/memory, secrets, cron, region, or pre-deploy migration job. Database initialization runs in every container start.

## Windows local launchers

`start-githubarchive.bat` checks npm, installs dependencies if absent, initializes the database, starts Vite bound to `127.0.0.1:5173`, waits for the port, and opens `/admin/status` (which now redirects to `/admin`). It does not ensure the installed native dependency matches the active Node ABI.

`stop-githubarchive.bat` finds every process listening on port 5173 and force-stops it. It is not scoped by process command/project, so an unrelated service on that port could be terminated.

## Configuration drift

- README/schema prose says v9 while code/database are v13.
- GitHub user agent says product version `0.3` while package is `0.1.0`.
- `.env.example` archive batch/concurrency/delay/burst values differ from source defaults.
- Web autonomous daemon and CLI daemon implement different orchestration semantics.
- Several behavior-critical variables are undocumented: background-worker mode, publish grace/cooldown, source limits, ZIP creation, doctor/storage destructive policies, and export path.
