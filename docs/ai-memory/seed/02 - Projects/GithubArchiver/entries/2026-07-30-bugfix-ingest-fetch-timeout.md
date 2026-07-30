---
schema: 1
id: bugfix-ingest-fetch-timeout
date: 2026-07-30
area:
  - discovery
  - daemon
  - observability
type: bugfix
status: open
confidence: confirmed
durability: release
relationships:
  - type: caused-by
    id: incident-daemon-ingest-hang
  - type: related
    id: incident-freshness-stall
title: GH Archive fetch AbortSignal timeout + ingest wall-clock + heartbeat
---

# Ingest timeout hardening

Prevents recurrence of the 75-minute silent ingest wedge (`incident-daemon-ingest-hang`).

## Changes

1. **`gharchive.ts`** — `GhArchiveTimeoutError` + `withGhArchiveTimeout`. AbortSignal covers **fetch + body stream** (not headers-only). Default `GH_ARCHIVE_FETCH_TIMEOUT_MS=30000` (env-overridable).
2. **`workers/ingest.ts`** — per-hour start/complete logs + `job_runs` heartbeat (`current_hour`, `heartbeat_at`); whole-cycle `INGEST_WALL_CLOCK_MS` (default 10 min); **always** `finishJobRun` on throw/timeout so planner retries without waiting for orphan reconcile.
3. **`ingest-core.ts`** — maps `GhArchiveTimeoutError` → hour `outcome: 'failed'` (not an unhandled crash).

## Tests

- `tests/gharchive-fetch-timeout.test.ts`
- `tests/ingest-cycle-hardening.test.ts` (catch-and-mark-failed; wall-clock early stop)

## Remaining

- Planner: score enrich on claimable, not raw unenriched
- Retry hygiene: exclude attempt-exhausted from coverage/claimable counts
- Optional: raise default fetch timeout if 30s false-positives on large hours in prod
