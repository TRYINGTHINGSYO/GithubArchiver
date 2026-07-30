---
id: bugfix-periodic-job-reconcile
date: 2026-07-30
area:
  - daemon
  - ingest
  - jobs
type: bugfix
status: verified
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: caused-by
    id: incident-daemon-ingest-hang
  - type: caused-by
    id: incident-deploy-abort-stream-crash
  - type: related
    id: bugfix-ingest-fetch-timeout
  - type: related
    id: feature-running-job-age-homepage
title: Periodic job_runs reconcile + boot age-0 so stuck running cannot last forever
---

## Investigation (Step 1)

Deployed build **does** contain fetch timeout + wall-clock (`2f5e817` / Railway `41a32c9c`). Recent `job_runs` show `GH Archive fetch timed out after 30000ms` — primary path works for new cycles.

Stuck rows (prod SSH 2026-07-30):

| id | type | started_at (UTC) | detail |
| --- | --- | --- | --- |
| 364183 | ingest (daemon wrapper) | 09:59:19 | `daemon_action=ingest`, parent 364182 |
| 364184 | ingest (inner cycle) | 09:59:19 | `current_hour=2026-07-25-02`, `phase=starting`, last `heartbeat_at=10:00:47` |
| 364182 | daemon | 09:57:43 | orphaned from crash deploy |

Not concurrent workers. Single-threaded loop + **double `startJobRun`** (daemon wrapper + `runIngestCycle`) + crash orphans. Hour `2026-07-25-02` is the AbortError crash that killed the failed deploy; process never `finishJobRun`'d.

Boot reconcile used **10m age floor**. New process started ~10:06; orphans were ~7m old → **skipped**. No periodic sweep → stuck 8h+ while live ingest continued.

GH Archive was slow/unreachable (many timed-out hours); that did not leave the live loop hung — only the orphaned rows.

## Fix (Step 2)

1. Boot `reconcileOrphanedJobRuns(0)` — reclaim every leftover running row from a dead process.
2. Periodic `maybeReconcileStaleJobRuns` every `DAEMON_RECONCILE_INTERVAL_MS` (2m), hard ceiling `ORPHAN_JOB_AGE_MS` (15m), exclude live daemon id; `console.error` SAFETY NET when it fires.
3. Stop double-booking worker-owned actions (ingest/enrich/archive/refresh/search_gap).
4. `raceIngestHour` against cycle deadline so a non-resolving `ingestHour` cannot bypass between-hours wall-clock.

## Tests

- Boot age-0 catches 7m crash orphans the 10m floor misses
- DB-only planted stuck row closed by periodic sweep + error alert
- Hung `ingestHour` → terminal `failed` within wall-clock
- Healthy cycle completes while an unrelated stuck row stays for the safety net
