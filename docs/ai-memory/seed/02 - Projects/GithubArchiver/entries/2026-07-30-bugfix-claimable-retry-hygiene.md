---
schema: 1
id: bugfix-claimable-retry-hygiene
date: 2026-07-30
area:
  - enrichment
  - daemon
  - observability
type: bugfix
status: open
confidence: confirmed
durability: release
relationships:
  - type: caused-by
    id: incident-daemon-ingest-hang
  - type: related
    id: incident-freshness-stall
  - type: related
    id: bugfix-ingest-fetch-timeout
title: Claimable backlog agrees with claim batch; planner scores claimable not raw unenriched
---

# Retry hygiene + planner scoring (one definition)

## Problem

`countClaimableEnrichmentBacklog` omitted `enrichment_attempts < ENRICH_RETRY_LIMIT` while `claimEnrichmentBatch` enforced it. That produced:

- Coverage **99.3%** from `41867/(41867+283)` where 283 were attempt-exhausted dead retries
- Empty enrich spin: planner scored raw `unenriched` (~1.07M deferred), claim returned 0

## Fix (single source of truth)

1. **`countClaimableEnrichmentBacklog`** — same filters as claim (status/tier/due/claim-expiry/**attempts**). Shared via `enrichRetryLimit()`.
2. **`queryBacklogSnapshot.unenriched`** — now **claimable** count (documented on `BacklogSnapshot`). Planner score + enrich sleep threshold use it automatically.
3. Homepage Coverage denominator uses `claimableBacklog` (not stale `worker_progress.remaining`).

## Tests

- Attempt-exhausted excluded; count === claim batch size
- Planner: claimable=0 → enrich score 0; prefers ingest when hours missing
