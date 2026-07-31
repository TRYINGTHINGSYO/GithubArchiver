---
schema: 1
id: research-github-concurrency-curve
date: 2026-07-30
commit: 0505b90
area:
  - enrichment
  - observability
  - networking
type: research
status: open
confidence: confirmed
durability: temporary
relationships:
  - type: caused-by
    id: research-metadata-phase-span-baseline
  - type: references
    id: feature-metadata-phase-spans
title: Isolated GitHub fetch stays ~300ms through concurrency 12
---

# Isolated GitHub fetch stays ~300ms through concurrency 12

Measurement-only probe on the production Railway container (`npm run measure:github-concurrency`). Daemon enrich concurrency was **not** changed.

## Curve (n=30 per level, 0 errors)

| conc | thru/min | TTFB p50/p95 | body p50/p95 | queue p50 | reuse |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 198.3 | 300 / 355 | 2 / 10 | 4242 | 97% |
| 2 | 395.8 | 286 / 365 | 2 / 9 | 1992 | 97% |
| 4 | 773.9 | 291 / 356 | 2 / 7 | 912 | 93% |
| 8 | 1459.9 | 296 / 380 | 1 / 14 | 317 | 87% |
| 12 | 2071.3 | 274 / 359 | 1 / 5 | 275 | 87% |

Connection spans: DNS/TCP/TLS p50 ≈ 0 (reuse). Event-loop p95 ≈ 11–13 ms. Body ~6.4 KB. Rate-limit remaining stayed thousands; no `retry-after`.

## Contrast with enrich baseline (n=337)

| metric | isolated @12 | enrich cycle |
| --- | ---: | ---: |
| TTFB p50 | 274 ms | 7554 ms |
| bodyRead p50 | 1 ms | 5563 ms |
| queueWait p50 | 275 ms | 18256 ms |

## Hypothesis verdicts

1. No connection reuse — **rejected**
2. Pool saturation mislabeled as TTFB — **rejected in isolation**
3. Silent GitHub throttle — **rejected here**
4. Event-loop starvation during enrich — **primary remaining**
5. Shared NIC vs ingest — **unlikely alone** (probe ran beside ingest and stayed fast)
6. Body stream scheduling for small JSON — **rejected in isolation**

## Implication

Do **not** raise enrich concurrency. Throughput still scales at 12 when HTTP is isolated. Next measurement should interleave sync SQLite work with the same fetch pool to reproduce enrich-path TTFB/body inflation.
