---
id: feature-ingest-timeout-hour-backoff
date: 2026-07-30
area:
  - ingest
  - gharchive
type: feature
status: done
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: caused-by
    id: research-archive-backlog-pace
  - type: references
    id: migration-036-ingest-hour-backoff
  - type: related
    id: bugfix-ingest-fetch-timeout
title: Per-hour fetch/timeout backoff so sticky hours stop taxing every cycle
---

## What

On ingest `failed` (timeout/fetch/parse), record `ingest_hour_backoff` with markJobFailed-shaped exponential delay (base `INGEST_TIMEOUT_BACKOFF_BASE_MS` default 15m → 30m → … cap 8x). `listMissingHourKeys` skips hours still in backoff; `countMissingGhArchiveHours` still counts them so planner priority stays honest. Success via `recordHourIngested` clears the row.

## Why

Post-wedge pace (~2.4 archive-h/wall-h) was real, but sticky holes (`2026-07-25-18/19`) burned two 30s timeouts every cycle before productive hours. Widening the global fetch ceiling would false-fail large hours; per-hour cooldown only kicks in after a specific hour proves sticky.

## Tests

`tests/ingest-hour-backoff.test.ts` — backoff math, attempt-batch skip vs planner count, escalate + clear on success.

## Verify after deploy

Sticky hours appear in `ingest_hour_backoff`; subsequent cycles' first attempted hour advances past them; pace buckets should improve vs `research-archive-backlog-pace` baseline.
