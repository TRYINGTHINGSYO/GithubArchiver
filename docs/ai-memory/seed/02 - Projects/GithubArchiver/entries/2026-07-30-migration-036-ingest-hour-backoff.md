---
id: migration-036-ingest-hour-backoff
date: 2026-07-30
area:
  - ingest
  - schema
type: migration
status: verified
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: implemented-by
    id: feature-ingest-timeout-hour-backoff
  - type: references
    id: research-archive-backlog-pace
title: Schema 36 — ingest_hour_backoff table
---

Adds `ingest_hour_backoff` (`hour_key`, `consecutive_failures`, `last_error`, `last_failed_at`, `next_retry_at`) so sticky GH Archive fetch/timeout failures can skip the attempt batch without disappearing from the planner missing count.
