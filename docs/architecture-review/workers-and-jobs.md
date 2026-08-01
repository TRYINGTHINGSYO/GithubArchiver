# Workers, jobs, and data pipelines

## Execution models

GithubArchive+ has four overlapping ways to execute work:

| Model | Entry point | Ownership/durability | Concurrency |
|---|---|---|---|
| Autonomous web daemon | `background-daemon.ts`, booted by `hooks.server.ts` | Process-local loop; decisions/jobs persisted after selection | One selected action at a time; archive cycle has internal concurrency |
| Manual web job runner | `/api/admin/workers`, `job-runner.ts` | Process-local promise chain; history persisted, queue intent not persisted | One manual queued job at a time |
| Inline HTTP action | Repo actions/export, maintenance endpoints | Bound to request; selected history may be persisted | Can overlap daemon and queue |
| CLI scripts | `scripts/*.ts` | Shell/process ownership; some record jobs | Independent process; can overlap everything else |

SQLite `job_runs` is a history ledger, not a work queue. There is no lease, heartbeat, cancellation flag, retry counter, scheduled-at column, unique work key, dead-letter state, or multi-process mutex. Running two web replicas or a web daemon plus CLI can duplicate calls and contend on SQLite/files.

## Worker catalog

| Worker/job | Autonomous schedule | Input | Output | Retry/failure | Main performance bound |
|---|---|---|---|---|---|
| Ingest missing | Planner when eligible hour backlog exists | Bounded missing hour keys | Repositories/events, `ingestion_state`, job detail | Recent retries/grace/cooldown; stream errors fail hour | GH Archive bandwidth/decompression/JSON lines |
| Ingest one hour | Manual/CLI | Explicit or previous UTC hour | Same as above | Same hour semantics | One hourly archive stream |
| Search gap/ingest | Planner when search gap/fallback; manual/CLI | Hour key/category qualifier | Repositories and `search_ingest_stats` | Shards overloaded results; later cycles/manual retry errors | GitHub Search quota, 2s page delay, 1,000-result cap |
| Enrich | Planner when unenriched backlog; manual/CLI | Up to 50 repository rows | Current metadata, history/events/releases/intelligence/FTS | Future cycles retry while unenriched; 404 deletes | Several GitHub calls/repo and 800ms delay |
| Refresh | Planner when interval-due; manual/CLI | Up to 50 enriched rows | Updated current metadata, metrics/history/events/releases/intelligence/FTS | Future interval; optional subfetch failures may be swallowed | GitHub quota and 800ms delay |
| Archive | Planner/manual/CLI/inline | Enriched rows with default branch | README/source/optional ZIP files, snapshots/events | Permanent blocked outcomes suppress planner retry | Network, 50 MiB buffers, concurrency 5, disk |
| Backfill resume | Planner/manual/CLI | Durable job and up to configured hours | Updated hour/job ledger plus ingest/search outputs | Resume remaining/failed work explicitly | Hour count and upstream quotas |
| Pipeline once | Manual/CLI | Current backlogs | Sequential bounded ingest/enrich/refresh/archive child results | Parent fails on thrown error; child semantics apply | Sum of child work; duplicate job rows |
| Backup | Manual/CLI | DB, archive manifest, optional archive tree | Timestamped backup directory/archive and metadata | No automatic retry | SQLite copy, full disk traversal/copy/compression |
| Bulk export | Admin/manual queue | Repository scope | Manifest and job ZIP, per-repo ZIP snapshots | No automatic retry | Potential archive-sized disk/network/CPU |
| Doctor | Admin/CLI | DB/filesystem/job/checkpoint state | Checks and optional FTS/missing-snapshot repair | Manual rerun | Full archive walk/FTS rebuild |
| Storage analysis/cleanup | Admin/CLI/daemon policy | Archive tree/snapshot rows | Report and optional deletions | Manual rerun; deletion not automatically reversible | Full filesystem scan/hash and deletion I/O |

## Autonomous planner

The in-process daemon performs this loop:

1. Reconcile stale `job_runs` that have remained `running` for more than ten minutes.
2. Measure backlogs: missing GH Archive hours, search gaps, active backfill hours, unenriched repos, refresh-due repos, enriched repos without source snapshots, and GitHub rate-limit state.
3. Rank available actions with deterministic scores.
4. Persist a `daemon_decisions` row with chosen action, reason, and backlog JSON.
5. Start a parent/child job record and execute one bounded worker cycle.
6. Optionally repeat archive cycles in a burst while unarchived backlog exceeds the threshold.
7. Sleep based on remaining backlog, idle range, or exponential failure backoff.

Approximate base priorities encoded by the planner:

| Action | Score behavior |
|---|---|
| Ingest missing hours | Base around 150 plus missing-hour weight; normally highest when history gaps exist |
| Archive | Base around 140 plus unarchived count; intentionally above enrich for realistic backlogs |
| Backfill | Base around 90 plus backlog |
| Search gap | Base around 85 |
| Enrich | Base around 80 plus logarithmic backlog, capped around 130 |
| Refresh | Base around 50 plus logarithmic backlog |
| Idle | Only when all queues are empty or GitHub is rate limited |

Rate-limit state forces idle even with backlog. Decision diagnostics distinguish expected rate-limit idle from an unexpected planner idle. The planner's unit tests specifically protect ordering/sleep behavior.

Default idle sleep is random between 5 and 15 minutes; failure backoff grows from 1 to 15 minutes. Backlog normally shortens sleep, and an archive backlog at/above 1,000 caps it at 60 seconds. `.env.example` sets archive burst cycles to 3, while source default is 4.

`BACKGROUND_WORKER` modes:

- `true`/enabled: start inside the web process.
- `false`/disabled: do not start.
- `auto` (default): start when `RAILWAY_ENVIRONMENT` or `RAILWAY_PROJECT_ID` is present.

Boot occurs on the first HTTP request, not process module initialization.

## Discovery and ingest pipeline

### GH Archive hour ingest

Input is `https://data.gharchive.org/{hourKey}.json.gz`. The parser streams gzip JSON-lines and selects repository creation events. It records:

- total parsed event count;
- inserted repository count;
- skipped/duplicate count;
- source and completion/unavailable status in `ingestion_state`.

Each new repository inserts a `repos` row and first-seen event, then indexes the initial metadata in FTS. `full_name` uniqueness provides idempotency across multiple sources, but event ids are not unique.

Recent files may not yet be published. The default publish grace is three hours after an hour ends; same-UTC-day 404s are excluded from missing backlog; older 404 attempts have a six-hour retry cooldown. CLI/worker ingest retries recent transient attempts up to three times with exponential delay starting at five seconds. Malformed JSON lines are skipped; broken streams/gzip fail the hour.

The automatic search fallback is attempted only when an hour contains at least 1,000 parsed events but zero matching repository creation events. An all-unavailable cycle is treated as successful/expected rather than worker failure.

### GitHub Search discovery

GitHub Search queries `created:{time range}` ordered by creation. Because the API caps accessible results around 1,000, windows recursively shard from one hour to 15-minute, 5-minute, and 1-minute segments up to depth 3. Each query records `search_ingest_stats`. Defaults are ten pages, 100 results per page through GitHub's API behavior, and two seconds between pages.

Search-discovered rows use `discovery_source='github_search'`. Search API `created_at` supplies repository creation time; first-seen represents ingestion/discovery time in insert paths, though the event helper can blur that distinction in one append path. `incomplete_results` is recorded but not automatically retried through a durable policy.

Before category-gap search, current category proportions are rolled up. Categories below 1% can map to hardcoded GitHub qualifiers, and a deterministic hour hash rotates selection. Only CLI tool, game, data/ML, DevOps, web app, and library have search qualifiers. Categories completely absent from the rollup are invisible to the underrepresentation query.

## Enrichment pipeline

The enrich worker selects unenriched, nondeleted repositories in batches (default 50) and waits 800 ms between API-heavy iterations.

For each repository it:

1. Fetches GitHub repository metadata.
2. Handles 404 as deletion and detects repository rename/archived status.
3. Fetches default-branch head commit and records a new commit observation when changed.
4. Updates current metadata in `repos`.
5. Computes deterministic summary and category.
6. Records selected metadata/history events.
7. Fetches releases and tags, keeps up to roughly 30, inserts unseen release tags and assets.
8. Updates FTS.

Important semantics:

- Initial enrichment does not insert `repo_metrics_snapshots`; the first metrics baseline appears during refresh.
- Classifier input includes metadata/topics and a README excerpt when available, but the caller does not pass file paths. File-path rules in the classifier are therefore dormant in the normal pipeline.
- Releases are insert-if-new. Existing release bodies/names/URLs and asset download counts are not updated.
- Optional release/tag/history helpers swallow several non-404 errors; rate-limit/network faults can look like empty optional data.
- A GitHub token is strongly recommended. Without it, GitHub's public unauthenticated quota is much smaller and the daemon will spend more time rate-limit idle.

## Refresh pipeline

The refresh worker selects enriched, nondeleted repositories whose `last_checked_at`/enrichment age exceeds `REFRESH_INTERVAL_HOURS` (default 24), batch 50, 800 ms delay. It refetches metadata, detects rename/archive/delete/default-branch/license/topic/metric changes, appends history/events, adds a metrics snapshot, refreshes releases, recomputes intelligence, and updates FTS.

Metrics snapshots are appended even if counters are unchanged, while metric-change events are conditional. This creates a regular time series but no compaction. Rename writes current `repos` identity plus `repo_aliases` plus an event. License/topic changes write current state, history, and event.

## Archive pipeline

The archive worker selects enriched, nondeleted repositories with a known default branch, no existing `source` snapshot, and no permanent `archive_failed` event. It orders by oldest enrichment timestamp (FIFO). Worker defaults are 50 repositories, concurrency 5, and 100 ms interlaunch delay; `.env.example` recommends 25/3/300 ms. The standalone CLI uses older defaults of 10/1,000 ms.

For each repository:

1. Fetch raw README. Hash and compare with latest README snapshot; when changed, write a timestamped file, insert `archive_snapshots`, emit `readme_changed` and `snapshot_created`, and reindex FTS.
2. Fetch default-branch head SHA. If it matches latest source head, skip source download.
3. Download GitHub's source tarball with a 50 MiB default limit and 120-second timeout. The entire tarball is buffered in memory before write.
4. Write `.tar.gz`, hash it, insert a `source` snapshot, and emit evidence events.
5. Optionally convert the tarball to ZIP and insert a `zip` snapshot. ZIP creation is off by default unless `ARCHIVE_CREATE_ZIP` or an export path enables it.

Outcome classification treats saved/skipped as normal, `too_large` and `timeout` as permanent blocked, and generic errors as transient issues. HTTP 409/422 archive failures are also treated as permanent; 404 can mark the repository deleted. Permanent archive-failure events exclude a repository from future automatic archive selection.

### Archive cadence defect

The queue condition is “no source snapshot exists,” not “head differs from latest source.” Once any source snapshot has been saved, the autonomous archive worker never selects that repository again. The head comparison code is useful only when an explicit/manual/export archive call reaches it. As a result, ongoing repositories do not receive periodic changed-source preservation automatically.

### Memory envelope

Five default concurrent downloads at the 50 MiB limit can retain approximately 250 MiB of raw buffers before Node/HTTP/compression/object overhead. ZIP generation and source analysis add decompressed buffers. This is a configured worst-case estimate, not a measured production peak.

## Source analysis and browsing

`source-archive.ts` reads a source tarball, rejects compressed files above `SOURCE_ANALYSIS_MAX_BYTES` (default 30 MB), then synchronously reads and gunzips the full archive. It parses at most 7,000 tar entries, returns at most 800 files and 200 folders, retains 12 largest-file entries, and limits language summaries. It detects common technology/config/security filenames and builds an entry index.

Analysis and index results are cached in unbounded process-local maps keyed by snapshot. There is no TTL, LRU, invalidation on storage cleanup except explicit reanalysis, or shared cache. Reading an individual file may gunzip and scan the archive again. The main repository loader does not currently expose this analysis.

## Backfill pipeline

Backfill creates a durable `backfill_jobs` row and per-hour `backfill_hours` plan for an inclusive date range. `source=auto` attempts GH Archive and can use GitHub Search fallback; explicit sources restrict behavior. A resume cycle processes up to `max_hours_per_run` (default six in range/admin flows, 24 for the day CLI), updates counters/status/errors, and leaves remaining hours for later resume.

The autonomous planner prioritizes active backfill after real-time ingest/archive but before enrich. The API can create arbitrarily large or inverted/invalid ranges because validation is minimal.

## Backup, restore, export, doctor, and storage jobs

### Backup

Uses SQLite's backup API to produce a consistent database copy, writes metadata and an archive manifest, optionally copies the full archive tree, and optionally compresses the backup directory. Backups are timestamped under `BACKUPS_DIR`. A manifest-only backup protects database state and file inventory but not archive bytes. No offsite upload, encryption, scheduled retention, or automatic restore test exists.

### Restore

CLI-only destructive workflow requiring `RESTORE_CONFIRM`. It checks for an active local dev server, restores the database and optionally archive content from supported directory/compressed formats, and preserves a pre-restore database copy. Operators are told to stop workers first. It cannot coordinate with a remote replica or prove all file handles are closed.

### Bulk export

Runs in the manual queue, enumerates a scope, ensures per-repository ZIP archives, writes manifest metadata and a final job ZIP, and updates job detail. Existing ZIP snapshots are reused. Export files remain indefinitely unless manually removed outside this application.

### Doctor

Checks database opening, schema version, missing archive files, orphan archive files, unsafe/broken paths, FTS row counts, recent job failures, and daemon checkpoint. Optional repairs rebuild FTS or record missing snapshot evidence. It does not repair archive bytes, database corruption beyond open/schema checks, release/history inconsistencies, or foreign-key drift comprehensively.

### Storage analysis/cleanup

Synchronously walks the archive tree, calculates largest repositories, groups snapshot hashes for duplicates, finds orphan files, and identifies old snapshots. Cleanup can remove orphans, duplicate snapshots/files, generated ZIPs through environment policy, and all but the latest N snapshots when `STORAGE_KEEP_LAST_N` is explicitly configured. It protects selected latest snapshots and shared path references.

This cleanup capability conflicts with a strict append-only preservation promise. Deletion is recoverable only from a backup that actually included archive bytes.

## Job recording and duplicated work records

Workers frequently create and finish their own `job_runs`. The autonomous daemon and pipeline runner can also create parent/child job rows around those workers. One logical action may therefore appear multiple times in job history. The relationship is carried mainly in JSON/reason rather than a `parent_job_id` foreign key.

On process boot, running jobs older than ten minutes are marked failed as orphaned. A legitimate long backup, export, archive burst, or maintenance scan could be marked failed if another process performs reconciliation while it is still active; there is no heartbeat to distinguish it.

## Failure, retry, and idempotency matrix

| Pipeline | Retry | Idempotency control | Permanent failure behavior |
|---|---|---|---|
| GH Archive ingest | Recent-hour exponential retry; future planner cycles | `ingestion_state.hour_key`, `repos.full_name` | 404 grace/cooldown; older gaps re-enter backlog |
| Search ingest | Recursive shard and future cycles | `repos.full_name`; telemetry per attempt | Incomplete/error recorded; no durable per-query retry policy |
| Enrich | Future daemon cycles if `enriched_at` stays null | Current repo updates; unique releases | 404 marks deleted |
| Refresh | Future interval cycles | Change-only history plus current updates | 404 marks deleted; optional subfetch failures may be swallowed |
| Archive | Future cycles only while no source and no permanent event | Hash/head comparisons; snapshot rows not unique | Too-large/timeout/409/422 exclude automatic retry indefinitely |
| Backfill | Explicit/daemon resume | Unique `(job_id,hour_key)` | Failed hour/job retains error for resume/inspection |
| Manual queue | No queue-level automatic retry | None beyond worker internals | Job marked failed; user retries manually |
| Backup/export/maintenance | None | Timestamp/job-specific output | Partial files may remain; job error recorded |

## Operational gaps

- No durable database-backed queue or work lease.
- No scheduler ownership across replicas.
- No cancellation, pause, priority override, per-job retry, or dead-letter UI.
- No global GitHub request budget allocator across workers.
- No backpressure based on CPU, memory, disk throughput, or HTTP load.
- No automatic archive refresh after first source capture.
- No retention for jobs, decisions, metrics, events, telemetry, logs, or exports.
- No worker metrics/alerts/service-level objectives.
- No transactional boundary covering database rows and filesystem writes.
