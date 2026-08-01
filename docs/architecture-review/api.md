# HTTP API reference

## Global behavior

All endpoints are SvelteKit server routes in the same Node process as the website. There is no version prefix, OpenAPI description, client SDK, authentication, authorization, API key, per-client rate limit, request schema library, or consistent error envelope. JSON routes generally use `{ error }` for failures; SvelteKit `error()` routes use its framework error response. Download routes return file streams or buffers.

Every endpoint below is publicly callable in the current implementation, including administrative and destructive operations.

List/search query parsing is shared. Supported query parameters are:

| Parameter | Interpretation |
|---|---|
| `q` | FTS query; required only on `/api/search` |
| `language` | Exact repository language |
| `source` | `gharchive` or `github_search`; other values ignored |
| `feed` | Legacy/current feed selector; `recently_deleted` implies deleted-only |
| `sort` | Parsed sort such as newest discovered/created, stars, forks, recently archived/released |
| `year` | Numeric created/discovered-year filter depending query logic |
| `date_from`, `date_to` | Text timestamp/date bounds |
| `never_enriched` | Boolean when `1` |
| `archived_only` | Requires an archive snapshot when `1` |
| `has_readme` | Requires README snapshot when `1` |
| `has_release` | Requires release when `1` |
| `deleted_only` | Deleted repositories only when `1`; also includes deleted rows in base query |
| `min_stars`, `min_forks` | Numeric lower bounds |
| `page`, `per_page` | Numeric pagination, defaults 1 and 50 |

Several numeric parameters are converted with `Number()` but not checked for finiteness, negativity, or integer range before reaching query code. Callers should not rely on invalid inputs receiving a clean 400 response.

## Public discovery and history endpoints

### `GET /api/repos`

Lists repository summaries using the shared filters and pagination. Response merges the paginated result (`repos`, pagination totals/fields), global repository stats, and available languages. Data comes from `repos`, correlated archive/release checks, FTS when `q` is present, and aggregate queries. Read-only. Typical database errors become a 500 framework response.

### `GET /api/search`

Requires nonblank `q`; returns 400 `{ error: 'q parameter is required' }` otherwise. Uses the same filters as `/api/repos`, forces the query into FTS, and returns the paginated result without global stats/languages. Search snippets are HTML fragments with mark tags.

### `GET /api/birth-feed`

Uses shared filters, defaulting sort to `newest_discovered`. Response includes repository page results, languages, discovery sources, and normalized filter values for the UI. Read-only.

### `GET /api/events`

Parameters:

- `limit`, default 100, upper cap 500;
- `type`, one of the hardcoded repository event types;
- `since`, timestamp lower bound;
- `repo_id`, numeric repository id;
- `since_live_id`, process-local memory-event cursor.

Response: `{ events, memoryEvents, count }`. Persistent events join repository identity and parse `payload_json`; each receives a human label. `memoryEvents` come from a separate process-local ring of at most 200 events and disappear on restart. Invalid event types return 400. Invalid/nonfinite repository/live ids are ignored. An invalid numeric limit can propagate because only `Math.min` is applied.

### `GET /api/trends`

Returns `{ trends, overview }`. Trends include recent star deltas, languages, topic activity, and event bursts computed from current tables and 24-hour metrics; overview exposes live operational counts. Results use process-local short-TTL caches. No parameters.

### `GET /api/releases/latest`

Parameter `limit`, default 50, capped at 100. Returns `{ releases, count }`. Invalid `limit` is not explicitly rejected.

## Repository endpoints

All use the case-sensitive route `/api/repo/{owner}/{repo}` and resolve the current `repos.full_name`.

### `GET /api/repo/{owner}/{repo}/timeline`

Parameter `limit`, default 200, capped at 500. Returns the repository and combined historical timeline projection. Missing repository returns 404. Read-only.

### `GET /api/repo/{owner}/{repo}/state`

Optional `as_of` timestamp. Without it, uses current time. Returns basic repository identity plus:

- whether the repository existed by that time;
- resolved license and topics from latest history at/before the boundary, falling back to current row;
- latest commit observation at/before the boundary;
- observed/current metadata included by `RepoState`.

This is partial historical state, not a complete repository reconstruction. Missing repository returns 404. Invalid timestamps are normalized by `Date`/ISO handling and can fail as a server error rather than a validated 400.

### `GET /api/repo/{owner}/{repo}/files`

Finds the latest `source` snapshot, decompresses/analyzes it, and returns `{ available, snapshot_id, file_count, truncated, tree }`. If no source exists it returns 200 with `available:false`. Analysis errors are returned as `available:false` with an error string. `truncated` means analysis stopped at configured/archive parser limits. The endpoint performs CPU/memory-heavy synchronous archive work on cache miss.

### `GET /api/repo/{owner}/{repo}/files/content?path=...`

Requires `path`. Finds the latest source snapshot and extracts the requested file. For binary content it returns metadata and advises downloading the ZIP. For text it returns language class, total size, truncation flag, and UTF-8 content, limited by `SOURCE_FILE_MAX_BYTES` (default 512,000). Missing repository/snapshot/path/file returns 400/404 via SvelteKit errors.

The archive parser normalizes entry names relative to the GitHub tar root. It does not serve arbitrary filesystem paths, but each request may decompress the tarball again.

### `POST /api/repo/{owner}/{repo}/actions`

Body: `{ action }`.

| Action | Effect | Success | Notable errors |
|---|---|---|---|
| `refresh` | Enrich an unenriched row or refresh GitHub metadata/history/intelligence | Metadata message; refresh adds `metricsChanged` | Repository 404; GitHub/network errors 500 |
| `archive` | Fetch README/head/source and create snapshots/events | Raw archive result | 409 until enriched/default branch known; download failures may be encoded in result |
| `reanalyze-source` | Clear memory cache and analyze latest source tar | Analysis payload | 404 when no source |

Unknown action returns 400. Work runs inline on the request rather than through the manual serialized queue. There is no authorization, CSRF protection, timeout wrapper, idempotency key, or concurrency lock against worker activity.

### `GET /api/repo/{owner}/{repo}/export?type=source|readme`

This GET can mutate state. `type=readme` selects README; every other value selects source. It may archive the repository, create a ZIP from an existing tarball, insert snapshot/event rows, and write files, then 302-redirect to `/api/snapshots/{id}`. Source prefers an existing ZIP, then generates one, then falls back to a source tar if ZIP creation is unavailable. Missing repository returns 404; unenriched returns 409; inability to create a snapshot returns 404.

Because state changes are triggered by GET, browsers, crawlers, prefetchers, caches, and CSRF-style links can start expensive work.

## Snapshot and bulk-export endpoints

### `GET /api/snapshots/{id}`

Validates a positive numeric id, resolves the database path under `ARCHIVE_DIR`, requires an existing file, reads the entire file synchronously into memory, and returns it with type-specific content type, attachment filename, content length, `X-Snapshot-Id`, `X-Snapshot-Sha256`, and `Cache-Control: private, max-age=3600`. Invalid id is 400; missing row/file is 404.

This route is not streaming. A single request can allocate the entire configured 50 MiB source archive or larger generated ZIP; concurrent downloads multiply memory pressure.

### `GET /api/export/bulk?scope=...&format=zip`

Starts an asynchronous manual-queue export job despite using GET. Required `scope`: `all`, `active`, or `deleted`. Only `format=zip` is accepted. Success returns job id, queued status, and status/download URLs. Invalid input returns 400; a busy queue returns 409.

The export enumerates repositories, reuses/creates per-repository ZIP snapshots, builds a manifest, and writes `DATA_DIR/exports/bulk-export-{jobId}.zip`. There is no export retention or ownership model.

### `GET /api/export/bulk/{jobId}`

Requires a positive job id whose `job_type` is `export`. Returns selected job fields, parsed detail JSON, `downloadReady`, and a download URL when job status is success and the file exists. Invalid id 400; wrong/missing job 404.

### `GET /api/export/bulk/{jobId}/download`

Validates a successful export job and existing file, then streams the ZIP with content length, attachment name, and `private, no-store`. Invalid id 400; missing job/file 404; non-success job 409. Unlike individual snapshot download, this route streams.

## Administrative endpoints

### `GET /api/admin/status`

Returns the comprehensive admin projection from `getAdminStatus()`: repository/enrichment/archive/backlog counts, ingestion state, job runner and daemon status, GitHub rate limit, recent jobs/errors, backup summary, search-ingest telemetry, storage summary, and planner-related state. Some status collection touches disk and GitHub. Unauthenticated read.

### `GET /api/admin/jobs`

If `id` parses to a positive number, returns one job plus parsed detail. Otherwise lists jobs with `limit` (default 50, cap 200), `offset` (default 0), and optional `type`. Missing selected job returns 404. Negative and invalid pagination are not fully validated.

### `GET /api/admin/daemon/decisions?hours=24`

Clamps `hours` to 1–168 and returns recent decisions plus an idle-with-backlog diagnostic summary. Nonfinite input can still become nonfinite because `Math.min/Math.max` do not sanitize `NaN`.

### `POST /api/admin/daemon`

Body `{ action: 'start' | 'stop' }`. Starts/stops the in-process daemon via worker control. Start conflicts return 409; stop when not running returns 409; other action returns 400. The response contains a status/message and may include process-local state.

### `POST /api/admin/workers`

Queues one manual job in the process-local serialized runner. Body fields: `action`, optional `hour_key`, `include_archives`, `compress`.

Supported actions are `pipeline`, `ingest`, `ingest-missing`, `search-ingest`, `enrich`, `archive`, `refresh`, and `backup`. Success/queued returns 200 `{ ok:true, queued, message, ... }`; if the runner is busy it returns 409. Unknown action returns 400. `hour_key` format is not validated at the endpoint boundary.

### `GET /api/admin/backfill`

Returns active job, its progress, and 20 recent backfill jobs.

### `POST /api/admin/backfill`

Two modes:

- With `?resume=1`, queues resume for the active job and returns 200/409.
- Otherwise accepts `start_date`, `end_date`, optional `source` (`auto`, `gharchive`, `github_search`), `max_hours_per_run`, and `run_now`; creates a durable backfill definition and optionally queues it.

Only presence of the two dates is checked; ordering, valid dates, positive maximum, and range size are not validated here. The source also checks whether the pathname ends with `/resume`, but no SvelteKit route exists at `/api/admin/backfill/resume`; only the query-string form is reachable in this repository.

### `POST /api/admin/maintenance`

Rejects with 409 when the manual job runner reports busy, but maintenance itself executes synchronously and does not occupy the promise queue. Body action:

- `doctor`: optional `rebuild_fts`, `mark_missing_snapshots`; starts a maintenance `job_runs` row, runs checks/repairs inline, records success or failed health, returns report.
- `storage`: optional `delete_orphans`, `delete_duplicates`, `trim_old`; analyzes and optionally deletes files/rows inline, records a successful job if no exception.

Unknown action 400, exception 500. There is no confirmation token, dry-run nonce, authorization, CSRF protection, or backup prerequisite. `trim_old` only deletes when `STORAGE_KEEP_LAST_N` is configured; daemon-internal storage cleanup can also honor `STORAGE_DELETE_ZIPS` even though the HTTP body exposes no `delete_zips` field.

## Crawler endpoints

### `GET /robots.txt`

Allows `/`, disallows `/admin/` and `/api/`, and points to `/sitemap.xml`. This is advisory and is not access control. Cached publicly for one hour.

### `GET /sitemap.xml`

Contains only `/` and `/birth-feed`. It omits repository detail/timeline/compare pages and all future pagination. Cached publicly for one hour.

## API consistency and security gaps

- Mutation through GET exists for per-repository export and bulk-export start.
- No admin boundary exists; robots exclusion does not secure an endpoint.
- No JSON schema validation, content-type enforcement, body-size policy, idempotency, or optimistic concurrency.
- Inline repository actions bypass the serialized manual runner and can overlap daemon work.
- Limit parsing does not consistently clamp lower bounds or reject `NaN`.
- Snapshot download buffers while bulk export streams; content-serving behavior is inconsistent.
- There is no CORS policy in source, so default same-origin browser rules apply, but direct HTTP clients have unrestricted access.
- Status and job endpoints may expose raw errors, paths, or upstream details.
- There is no API compatibility/version policy; response types are inferred directly from implementation.

## Current callers and apparently external-only endpoints

| Endpoint | In-repository caller |
|---|---|
| `/api/repos`, `/api/search`, `/api/releases/latest` | Linked as developer-facing APIs from Home; pages load equivalent server functions directly |
| `/api/birth-feed`, `/api/trends` | Linked from Birth Feed; its initial page data uses server functions directly |
| `/api/events` | Birth Feed polling and repository-detail event refresh; also linked publicly |
| Repository files/content | `FileBrowser` |
| Repository actions | Repository detail action buttons |
| Repository timeline/state | No client fetch found; timeline page uses server function directly, so these are public/external API surfaces |
| Repository export/snapshots | Repository detail/archive badge/download links and server redirects |
| Bulk export start/status/download | Admin Storage; status/download URLs also returned by API/job detail |
| Admin daemon/workers/backfill | Current Admin page; duplicated references remain in dead Admin Status component |
| Admin jobs | Admin Jobs detail selection |
| Admin maintenance | Admin Doctor and Storage |
| Admin status | No direct UI fetch found; Admin uses its server loader and invalidation |
| Admin daemon decisions | No direct client fetch found; decision summaries are included through admin server data |

“No client fetch found” does not make an endpoint unreachable: all are public HTTP APIs and may have external callers not represented in this source export.
