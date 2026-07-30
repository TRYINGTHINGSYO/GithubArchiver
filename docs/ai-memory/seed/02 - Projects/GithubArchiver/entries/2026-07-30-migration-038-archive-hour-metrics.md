---
id: migration-038-archive-hour-metrics
date: 2026-07-30
area:
  - ingest
  - gharchive
  - metrics
type: migration
status: verified
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: caused-by
    id: incident-ingest-timeout-covers-db-writes
  - type: related
    id: bugfix-ingest-hour-transaction
  - type: related
    id: research-enrichment-selection-bound
title: Schema 38 — permanent archive_hour_metrics spans
---

## What

Adds `archive_hour_metrics` (one row per successfully downloaded GH Archive hour)
with separated spans:

- `archive_fetch_ms` — connection, headers, wait for next body chunk
- `archive_parse_ms` — JSON.parse + CreateEvent matching
- `archive_commit_ms` — chunked bulk insert (batches + yields)
- `archive_hour_total_ms` — fetch + parse + commit only (Search fallback excluded)
- `archive_rows_created` / `archive_rows_existing`
- `archive_batches` / `archive_deferred_rows`
- `archive_frontier_lag_hours`

`streamRepositoryCreates` and `commitGhArchiveCreates` emit the timings;
`ingestHourOnce` persists them via `recordArchiveHourMetrics`.

## Why

The ingest outage collapsed three distinct costs into one "fetch timed out"
message. Permanent separated spans prevent that class of misdiagnosis when the
next sticky hour appears.

## Tests

`tests/archive-hour-metrics.test.ts`, schema pin updates in
`daemon-migration` / `source-zip`, existing ingest commit + timeout suites.
