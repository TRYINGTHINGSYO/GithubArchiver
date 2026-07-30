---
id: research-enrichment-selection-bound
date: 2026-07-30
area:
  - enrich
  - metrics
type: research
status: verified
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: supersedes
    id: research-enrichment-throughput-ceiling
  - type: related
    id: incident-ingest-timeout-covers-db-writes
  - type: related
    id: bugfix-dashboard-trust-semantics
title: Enrichment is selection-bound and already 99.2% complete on the eligible corpus
---

## What

Measured on production via `npm run measure:enrichment`. The 1.1M "backlog" is
not a queue:

| bucket | count |
| --- | --- |
| unenriched, tier `deferred` | 1,120,894 |
| unenriched, tiers low/normal/high | 397 |
| claimable at measurement time | 0 |
| never attempted even once | 1,120,556 |

Coverage against the eligible corpus is **99.19%** (46,330 of 46,734), not the
3.95% corpus-wide figure. `assignEnrichmentTier()` defers on arrival, so
selective enrichment is not a strategy to evaluate — it already ships.

Throughput over correct windows: 212–246 completed/hour against 2,725–3,080
arrivals/hour. Net burn is negative, which is by design: ~92% of arrivals are
deferred immediately, and the eligible remainder is consumed within minutes.

Per-repo cost is one stage: metadata p50 11,186ms / p95 17,069ms of an 11,643ms
p50 total. Classification is 1.4ms, dbWrite 452ms, story 63ms. Concurrency is
configured at 12 (`ENRICH_WORKER_CONCURRENCY`) and `recommendedConcurrency()`
reduces it on quota pressure.

## Why this changes the plan

A concurrency sweep at 12/16/20/24 cannot produce a signal, because the claimable
set is 0 and cycles alternate between ~35–60s of real work and 1.6s no-ops. It
would measure an empty queue. The classification is **selection-bound**, with a
secondary latency anomaly on GitHub metadata that is not explained by the network
(the container fetches api.github.com in 254–372ms).

The 11s metadata figure is unexplained and worth its own investigation, but it
does not gate coverage: the eligible corpus is already caught up.

## Method correction

Two measurement errors were found and fixed rather than reported:

1. Window bounds used `datetime('now', ?)` against ISO-8601 rows. `'T'` sorts
   above `' '`, so every row from the current date matched any same-day cutoff and
   1h/3h/6h returned identical counts. Bounds are now JS ISO strings.
2. Sizing a widened eligibility policy by `stars`, `description` or
   `interesting_score` is circular — enrichment populates those columns, so every
   threshold returns zero for unenriched repos. Only event-derived signals
   (`enrichment_priority`, `repository_events`) exist at selection time. Of the
   deferred population, 115,759 sit at priority 25–49 and 1,003,528 at 10–24.

## Tests

Tooling only (`scripts/measure-enrichment.ts`), read-only, no assertions.

## Remaining verification

Explain the 11s metadata p50 against a 254–372ms single-request baseline. Suspect
per-request client setup rather than transport, since the probe used plain
`fetch` to the same host.
