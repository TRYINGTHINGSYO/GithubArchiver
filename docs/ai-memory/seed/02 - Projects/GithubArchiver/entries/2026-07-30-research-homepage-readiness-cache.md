---
id: research-homepage-readiness-cache
date: 2026-07-30
area:
  - ui
  - metrics
type: research
status: verified
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: related
    id: bugfix-dashboard-trust-semantics
title: The homepage is fast when warm; a 30s readiness TTL costs 6.4s per expiry
---

## What

Measured against production by timing sequential requests:

| request | time | cache state |
| --- | --- | --- |
| `/api/health` cold | 28.43s | container booting after deploy |
| `/api/health` warm | 0.36s | — |
| `/` warm | 1.88s, 2.95s | all caches hot |
| `/` at +35s | 8.33s | readiness TTL (30s) expired, pulse (5m) warm |

So the warm floor is ~1.9s and a single readiness recompute costs ~6.4s.

## Why

`getDataReadiness` runs ~17 aggregates on cache miss, several of them full scans
over 1.17M `repos` rows, including `COUNT(*)`, `COUNT(DISTINCT owner)`, and
predicates on `clustered_at` / `story_generated_at` which have no index. Its TTL
is 30s, shorter than the typical gap between visits, so most real visitors pay
the recompute — that is the reported 9.6s rather than anything structural.

`countRepos()` and `countUnenriched()` are each computed 3–5 times per request
from separate helpers. `discovery_system_status` already stores
`repositories_discovered`, `enriched`, `classified` and `clustered`, and
readiness recomputes all of them from scratch.

The load function is declared `async` but contains no `await`; every call is a
synchronous better-sqlite3 query, so they serialise and block the event loop.
Nothing in the path makes a network request.

## Ranked, cheapest first

1. Serve readiness counts from `discovery_system_status` or a maintained
   `corpus_stats` row instead of scanning; or raise the TTL well above 30s. Worth
   ~6.4s.
2. Memoise `countRepos` / `countUnenriched` per request. Worth ~0.3–1.5s.
3. Cache `getNewHighSignalRepos` and `countHighSignalRepos`, and narrow
   `SELECT r.*` (it reads `story_text` and `story_facts_json` to render a preview).
4. Add indexes for `clustered_at` and `story_generated_at`.

## Tests

None — measurement only, no code changed.

## Remaining verification

Confirm the sub-2s target holds at the readiness TTL boundary, not just warm, and
confirm `discovery_system_status` freshness is acceptable as a readiness source
before substituting it.
