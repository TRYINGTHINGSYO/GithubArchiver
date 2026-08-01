# Administration and operations

## Admin surface

The administration experience is fully embedded in the public SvelteKit app. `/admin` is the main control plane; `/admin/jobs`, `/admin/doctor`, and `/admin/storage` provide focused views. `/admin/status` redirects to `/admin` while retaining an unreachable legacy component.

There is no separation by hostname, network, deployment, identity, role, or feature flag. Hiding routes from robots is the only boundary, and robots directives are not security.

## Dashboard data

`getAdminStatus()` composes a broad status object including:

- total, active, deleted, enriched, unenriched, archive/README/source counts;
- archive backlog and permanent-failure counts;
- refresh-due and missing-ingestion backlogs;
- today's ingestion activity and latest hour;
- search-ingest status and recent runs;
- GitHub API rate-limit data;
- process-local manual runner busy label;
- autonomous daemon running state, last action/error/log/checkpoint;
- recent jobs, errors, and parent/reason data;
- backup summary;
- archive storage report/summary;
- active/recent backfill progress.

The admin page polls this projection approximately every ten seconds. Some subqueries are numerous and serial; the GitHub rate-limit status may make an upstream call. There is no snapshot cache or observability backend.

## Operator controls

| Control | Execution path | Safety properties |
|---|---|---|
| Start/stop daemon | In-process worker control | Process-local only; unauthenticated |
| Run full pipeline | Manual promise queue | Serialized in one process; no cancel |
| Ingest hour/missing | Manual queue | Optional hour string not strongly validated |
| Search ingest | Manual queue | Requires GitHub quota |
| Enrich/refresh/archive | Manual queue | Can overlap inline/daemon/CLI work |
| Backup | Manual queue | Optional archives/compression; no remote copy |
| Create/resume backfill | Durable plan + manual/daemon execution | Minimal range validation |
| Doctor/repair | Synchronous request | Rebuild/mark actions; no authenticated approval |
| Storage cleanup | Synchronous request | Deletes evidence/files; no mandatory backup/confirmation token |
| Bulk export | Manual queue | GET starts job; artifacts have no retention |

## Job history

`job_runs` records job type, status, start/finish, JSON detail, error, and optional reason. Admin lists/filter/select supports basic forensics. There is no parent id, progress percentage schema, log stream, retry/cancel button, owner, request id, host/process id, resource use, or artifact relation. Detail payload shapes differ by job.

Orphan reconciliation marks all running jobs older than ten minutes failed. The threshold is fixed in code and not tailored to long jobs. Because queue state is memory-local, restart loses pending promise work and relies on this cleanup for rows already marked running.

## Health/doctor checks

Implemented checks:

- database opens and a trivial query succeeds;
- schema version matches current code;
- snapshot rows point to existing files;
- archive files have corresponding rows;
- snapshot paths resolve safely beneath archive root;
- FTS row count matches repository count;
- recent job failures in a 24-hour lookback;
- daemon checkpoint freshness/state.

Repairs:

- rebuild all FTS documents;
- mark missing snapshot files as failure evidence.

Not checked comprehensively:

- `PRAGMA integrity_check`/foreign-key check results in displayed health;
- file content hash vs stored SHA for every artifact;
- release/history/current-state consistency;
- stuck backfill/search rows;
- disk write/read test and free-space threshold;
- backup restorable status;
- upstream GitHub/GH Archive reachability;
- memory/CPU/event-loop saturation;
- duplicate daemon instances;
- secrets/configuration security.

## Storage administration

Storage analysis recursively walks archives synchronously. It reports total bytes/files/snapshots, largest repositories, duplicate SHA groups, orphan files, and old snapshot candidates. Cleanup options can delete:

- orphan files with no snapshot row;
- duplicate snapshot rows/files while protecting selected latest/reference-shared content;
- old snapshots beyond `STORAGE_KEEP_LAST_N` when explicitly enabled;
- ZIP snapshots when daemon/environment policy requests it.

Cleanup mutates both database and filesystem. Deleted bytes are not placed in a recycle bin and are recoverable only from a backup with archive content. There is no database audit row identifying the operator or every deleted artifact. A maintenance job detail provides aggregate/report evidence, but the caller is anonymous.

## Backup and disaster recovery

Backup types:

- **Manifest-only:** SQLite backup, metadata, and archive inventory; it does not preserve archive bytes.
- **Full:** includes archive tree bytes.
- Either can be compressed.

Restore supports documented CLI workflows, requires explicit confirmation, makes a pre-restore database copy, and can restore archive content. Existing docs recommend stopping server/daemon first and verifying the admin page afterward.

Operational gaps:

- no scheduled backup is declared by the application/platform configuration;
- no offsite/cloud destination;
- no encryption/key management;
- no automatic retention/rotation;
- no checksum verification job across all archives;
- no automated restore drill or recovery-time/recovery-point objective;
- full backup duplicates potentially large local archive data;
- manifest-only can create false confidence if archive volume is lost.

## Logs and telemetry

Available operational evidence:

- `job_runs` structured-ish JSON/error records;
- `daemon_decisions` with backlog/reason;
- daemon text log and checkpoint below `DATA_DIR`;
- `ingestion_state`, `search_ingest_stats`, and backfill ledgers;
- repository events including archive failures;
- process console output and platform logs.

Absent:

- log rotation/retention within code;
- structured JSON logger;
- Prometheus/OpenTelemetry metrics;
- traces and request spans;
- dashboards/alerts/on-call integration;
- Sentry or equivalent error reporting;
- per-endpoint latency/error counts;
- disk capacity alerting;
- GitHub quota exhaustion alerting;
- business/product analytics.

## Security posture

The admin control plane is unsafe to expose publicly in its current form. A remote caller can consume GitHub quota, fill disk through archives/exports/backups, trigger CPU/memory-heavy analysis, delete archive evidence, inspect paths/errors, and interfere with the daemon. Browser-based CSRF is especially relevant because no CSRF/origin validation exists and two expensive export operations use GET.

At minimum, the production topology needs an authenticated admin boundary and network restriction before more operational features. The absence is a current fact; no auth dependency or dormant implementation was found.

## Runbooks present and missing

Present documentation: README setup/operations, `docs/LOCAL_DESKTOP.md`, and `docs/RESTORE.md`. Windows start/stop batch files exist. CLI scripts expose most maintenance actions.

Missing runbooks include incident response, disk-full recovery, rate-limit exhaustion, corrupted database/WAL, missing archive volume, duplicate daemon, failed migration rollback, compromised GitHub token, export cleanup, backup rotation, Railway volume setup, and safe upgrade/rollback between schema versions.
