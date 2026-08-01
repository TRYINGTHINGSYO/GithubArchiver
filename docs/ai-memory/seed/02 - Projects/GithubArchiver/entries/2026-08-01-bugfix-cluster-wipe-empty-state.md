---
id: bugfix-cluster-wipe-empty-state
date: 2026-08-01
pr: 30
commit: 2c5b89f
area:
  - discovery
  - clusters
  - cache
type: bugfix
status: open
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: caused-by
    id: feature-durable-discovery-materialization
  - type: related
    id: feature-cache-hit-metrics
  - type: related
    id: incident-schema26-discovery-tables-missing
  - type: implemented-by
    id: pr-30
title: Wipe must clear stale cluster cards from materialization and TTL
---

## What

After deleting the database volume (or wiping repos/memberships while leaving discovery materialization), “Fastest-growing clusters” could still show cluster cards.

## Why

1. **Durable materialization** (`discovery_fastest_clusters`) is served when `last_discovery_analysis_at` is set. Partial wipes left last-known-good cluster payloads even with zero live memberships.
2. **Process TTL** (`cluster-analytics`, 30s) survived a DB path swap until the handle was reopened/cleared.
3. Migration **015** / `ensureClusterRegistry()` seed `CLUSTER_DEFINITIONS` into `repo_clusters` with `repo_count = 0`. Those registry rows are definitions, not displayable intelligence — UI must require live `repository_cluster_memberships`.

No client `localStorage` / IndexedDB cluster caches exist.

## Fix

- Gate growth/activity/preliminary cluster card builders on live memberships; require `repo_count > 0`.
- `getMaterializedDiscoveryLanding` refuses cluster cards when memberships are empty and purges stale cluster/project materialization rows.
- Clear TTL cache on DB close/reopen and after successful discovery materialization publish.
- Empty states: `no-repositories` vs `clustering-incomplete` vs growth guardrails.
- Dev-only flag `ALLOW_DEV_CLUSTER_PLACEHOLDERS` (unused in production; no placeholder arrays shipped).

## Tests

`tests/cluster-wipe-empty-state.test.ts` — fresh DB, repos-without-memberships, stale materialization after wipe, TTL invalidation on reopen.
