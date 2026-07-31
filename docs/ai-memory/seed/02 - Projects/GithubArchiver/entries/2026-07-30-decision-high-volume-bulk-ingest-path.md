---
schema: 1
id: decision-high-volume-bulk-ingest-path
date: 2026-07-30
area:
  - ingest
  - architecture
type: decision
status: verified
confidence: confirmed
durability: permanent
relationships:
  - type: caused-by
    id: incident-ingest-timeout-covers-db-writes
  - type: implemented-by
    id: bugfix-ingest-hour-transaction
  - type: references
    id: migration-038-archive-hour-metrics
title: High-volume ingestion needs a narrow bulk write path
---

# High-volume ingestion needs a narrow bulk write path

Archive hours went from never completing to ~7–10s after three layered fixes. The dominant gain was not network: the system spent almost all time in per-repository DB/index work on a feature-rich write path.

## Layers that recovered ingest

1. **Correct timeout boundary** — slow processing no longer masquerades as a failed GH Archive transfer.
2. **Chunked transactional writes** — batches of 200 + `setImmediate` so SQLite work does not freeze timers/health/event loop.
3. **Purpose-built bulk ingest path** — CreateEvents insert scored priority/tier directly, minimal FTS, defer metadata-dependent work; live-bus only after commit.

Layer 3 is the architectural lesson: a generic “insert repository” function does far more than archive ingestion requires.

## Rule

Every future high-volume source (website discovery, package feeds, etc.) gets its own narrow bulk path. Do not reuse the interactive/fully-enriched write path for firehose ingest.

## Capacity note

At 7–10s/hour, raw parse+commit capacity is hundreds of archive hours per wall hour when uninterrupted. Catch-up will be lower due to scheduling/verification/other jobs. Retain percentile archive metrics; do not optimize single-hour outliers.
