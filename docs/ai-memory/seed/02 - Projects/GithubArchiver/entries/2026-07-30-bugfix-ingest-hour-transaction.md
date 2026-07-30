---
id: bugfix-ingest-hour-transaction
date: 2026-07-30
area:
  - ingest
  - gharchive
type: bugfix
status: verified
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: caused-by
    id: incident-ingest-timeout-covers-db-writes
  - type: related
    id: research-archive-backlog-pace
title: One transaction per GH Archive hour, not one fsync per create
---

## What

After the timeout-scoping fix (`1aa761c`), ingest failed with a new error that
the 30s abort had been masking:

```
wall-clock limit exceeded while ingesting hour 2026-07-26-18
(599999ms remaining at start)
```

A single hour consumed the entire 10-minute cycle budget. Transfer and parse of
that file take ~2.5s on the container; the rest was SQLite.

Each repository create was its own auto-commit path: `insertRepo`, FTS index,
priority recompute (select + update), and `first_seen` event — roughly five
writes, each fsynced under the default `synchronous=FULL`, on a network-attached
volume. Events are now collected during the stream and written by
`commitGhArchiveCreates` in one better-sqlite3 transaction. `synchronous=NORMAL`
is set with WAL (the documented crash-safe setting for this journal mode). The
backfill runner uses the same helper so the two entry points cannot drift.

## Why

A budget that includes our own work cannot tell a stalled transfer from a slow
database, which is how the first layer of this incident looked like a fetch
timeout. Removing that abort without changing the write pattern just moved the
failure to the cycle wall-clock. Collecting before committing also means a
wall-clock abort mid-stream leaves the database untouched, ending the
`UNIQUE constraint failed: repos.full_name` noise from partial retries.

## Tests

`tests/ingest-commit.test.ts` — batch insert, duplicate skip, and a mid-batch
`RAISE(ABORT)` trigger proving every insert from the hour rolls back together.

## Verified on production

After three follow-up commits (timeout scope → chunked transactions → bulk
INSERT without per-row FTS/priority recompute):

```
2026-07-26-22: streamed 169278 → 2566 creates in 4614ms; committed +1550 in 2723ms
2026-07-26-23: streamed 170072 → 2643 creates in 2622ms; committed +2451 in 3502ms
2026-07-27-00: streamed 174872 → 3140 creates in 2627ms; committed +2970 in 6031ms
```

`latest_hour` advanced `2026-07-25-21` → `2026-07-27-03`. `last_ingest_at`
`19:02Z` → `23:33Z`. Backoff cooling `44` → `24`. Per-hour wall time ~7–10s.
