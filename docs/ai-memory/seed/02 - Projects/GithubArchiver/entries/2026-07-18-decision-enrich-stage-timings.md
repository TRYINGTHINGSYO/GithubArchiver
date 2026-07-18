---
schema: 1
id: decision-enrich-stage-timings
date: 2026-07-18
pr: 22
commit: d6c1647
area:
  - enrichment
  - throughput
  - observability
type: decision
status: open
confidence: confirmed
durability: permanent
relationships:
  - type: caused-by
    id: incident-enrichment-hourly-bottleneck
  - type: references
    id: incident-empty-createevent-defer
title: Profile enrichment with per-stage timings before more architecture changes
migration: 34
---

# Profile enrichment with per-stage timings

After continuous concurrent enrichment landed (~40+ repos/min, 8 workers), the next bottleneck is unknown. Guessing (API vs README vs classify vs SQLite vs story) wastes cycles.

## Decision

Instrument wall-clock time for each enrich stage and show last-cycle averages on Throughput:

- Metadata fetch (GitHub repo API)
- Classification (local intelligence)
- README (deep path only)
- Story generation (amortized per repo in the post-cycle batch)
- DB write
- Total

Also raise default `ENRICH_WORKER_CONCURRENCY` from 8 → 12 (still env-overridable; quota helper still backs off).

## Non-goals

- Do not treat deferred metadata-only backlog as claimable ETA (that produced the false “13 days” reading).
- Do not batch SQLite writes or split fast/expensive queues until stage timings prove those are the hot path.

## Schema

Migration **33** adds `avg_*_ms` columns on `enrichment_metrics`.

## Percentiles (follow-up on PR #22)

Averages hide long-tail stalls. Keep a process-local rolling window (default 2000 samples) and persist P50/P95 per stage in `stage_percentiles_json` (migration **34**).

Optimization sequence after deploy:
1. Collect several hundred / few thousand enrichments
2. Identify the stage with the largest wall-clock share (and check P95 vs P50)
3. Fix that bottleneck
4. Remeasure
5. Only then raise concurrency again
