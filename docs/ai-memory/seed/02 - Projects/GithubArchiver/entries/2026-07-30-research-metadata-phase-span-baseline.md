---
schema: 1
id: research-metadata-phase-span-baseline
date: 2026-07-30
commit: 3bf38c4
area:
  - enrichment
  - observability
type: research
status: open
confidence: confirmed
durability: temporary
relationships:
  - type: caused-by
    id: feature-metadata-phase-spans
  - type: references
    id: research-enrichment-throughput-ceiling
title: Metadata span baseline — HTTP TTFB dominates legacy 14s p50
---

# Metadata span baseline (post `3bf38c4`)

Captured 2026-07-31T00:22Z on production after deploy of metadata phase spans. No concurrency/pacing/selection changes. Rolling window **n=337**.

## Definitions

- `operationTotal` = rateLimit + HTTP ttfb/body/parse + postprocess + dbWrite (**excludes** queueWait)
- `endToEndTotal` = queueWait + operationTotal
- Legacy `metadata` p50 = wall clock of `fetchRepoMetadata` only

## metadataDetail (p50 / p95, n=337)

| span | p50 ms | p95 ms | n |
| --- | ---: | ---: | ---: |
| queueWait | 18256 | 39855 | 337 |
| rateLimitWait | 0 | 0 | 337 |
| httpConnectTtfb | 7554 | 17750 | 337 |
| bodyRead | 5563 | 13801 | 337 |
| parse | 0 | 0 | 337 |
| postprocess | 0 | 0 | 337 |
| dbWrite | 489 | 612 | 337 |
| operationTotal | 14969 | 26144 | 337 |
| endToEndTotal | 34815 | 49179 | 337 |

Legacy metadata: p50 **14398** / p95 **25635** (n=337). Last-cycle `avg_metadata_ms` ≈ 14856.

## Dominant span (for the 11–14s metadata mystery)

**Inside the legacy metadata metric:** `httpConnectTtfb` (p50 ~7.5s) then `bodyRead` (p50 ~5.6s). Together they account for nearly all of `operationTotal` / legacy metadata. `rateLimitWait`, `parse`, and `postprocess` are ~0. `dbWrite` is ~0.5s.

`queueWait` (p50 ~18s) is larger end-to-end but is **not** inside legacy `avg_metadata_ms`; it is mapPool slot wait before `enrichRepo`.

## Reconcile

- `operationTotal` p50 (14969) ≈ legacy metadata p50 (14398) + dbWrite p50 (~489).
- Summing component p50s is not exact arithmetic; residual legacy − (ttfb+body+parse) p50s ≈ 1.3s is percentile non-additivity, not a missing 11s stage.
- Plain single-fetch probe (~250–370ms) vs in-cycle TTFB p50 (~7.5s) implies contention under concurrency=12 / shared event loop — diagnose next, do not raise concurrency yet.

## Ingest health during window

Frontier advanced (e.g. `2026-07-28-12` → `2026-07-29-02+`). `archive_hour_metrics` totals typically 4–10s (fetch/parse/commit split healthy). No new archive-timeout incident observed in this window.
