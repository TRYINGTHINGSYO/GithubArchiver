---
id: incident-ingest-timeout-covers-db-writes
date: 2026-07-30
area:
  - ingest
  - gharchive
  - emerging
type: incident
status: open
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: caused-by
    id: feature-ingest-timeout-hour-backoff
  - type: caused-by
    id: bugfix-ingest-fetch-timeout
  - type: related
    id: bugfix-dashboard-trust-semantics
  - type: references
    id: migration-036-ingest-hour-backoff
  - type: related
    id: research-enrichment-selection-bound
title: The 30s GH Archive ceiling covers DB writes, so every hour fails and the frontier is frozen
---

## What

Ingest has failed 100% of hours since ~19:02Z. Every cycle records
`{"hours":0,"downloaded":0,"failed":6}` with `GH Archive fetch timed out after
30000ms`, burning 6 × 30s ≈ 182s every ~6 minutes. `ingestion_state` latest hour
is stuck at `2026-07-25-21`; missing hours went 116 → 117 during measurement.
47 hours carry backoff rows, 39 cooling down, several at 4 consecutive failures.

The timeout is not a transport failure. Measured on the production container for
the exact hour the logs report as timing out (`2026-07-26-5`):

| phase | container | local |
| --- | --- | --- |
| response headers | 155ms | 324ms |
| transport + gunzip | 1,390ms | 340ms |
| JSON.parse (172,413 events) | 925ms | 379ms |
| **total, no DB writes** | **2,470ms** | **1,043ms** |

Outbound network is healthy — GH Archive serves an 8MB range at 27.2 MB/s from
the container (faster than the 17.5 MB/s local control) and api.github.com
answers in 254–372ms.

## Why

`withGhArchiveTimeout` wraps the whole of `streamRepositoryCreates`, so the one
30s `AbortController` covers fetch, gunzip, per-line `JSON.parse`, **and** the
`await onCreate(repo)` callback that writes to SQLite. Transfer plus parse needs
2.5s, so roughly 27.5s of the budget is database work. The signal was widened
from "the initial fetch()" to "connection, headers, and body stream" to stop a
mid-stream abort crashing Node; that correctly fixed the crash and simultaneously
converted a transfer guard into a total-work guard. A budget that includes the
work cannot distinguish "the stream stalled" from "the hour was big".

Partial inserts commit before the abort, which is why repos keep arriving
(~2,725/hour) while `hours` stays 0, and why retries produce
`UNIQUE constraint failed: repos.full_name` (87 occurrences).

This is the upstream cause of the growth-comparison suppression surfaced in
`bugfix-dashboard-trust-semantics`: hour coverage sits at 49/168 (29%) against a
90% gate because the frontier has not moved in ~5 archive days.

## Tests

None yet — root cause confirmed by measurement, fix not written. A regression
test must prove the ceiling is not consumed by the `onCreate` callback, e.g. a
slow callback on a small fixture hour must not raise `GhArchiveTimeoutError`.

## Remaining verification

Scope the abort to transfer progress (stall detection) rather than total work, or
give parse+insert its own separate budget. After the fix: `hours` per cycle > 0,
`latest_hour` advances, `ingest_hour_backoff` drains, and hour coverage climbs
toward the 90% gate. Re-measure against the ~2.4 archive-hours/wall-hour baseline
in `research-archive-backlog-pace`.
