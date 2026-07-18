---
schema: 1
id: bugfix-nav-perf-clusters
date: 2026-07-18
pr: 23
commit: 30d6fd9
area:
  - discovery
  - performance
  - clusters
type: bugfix
status: open
confidence: confirmed
durability: release
relationships:
  - type: related
    id: decision-enrich-stage-timings
title: Fix dead cluster links and slow page navigation
migration: null
---

# Fix dead cluster links and slow page navigation

## Symptoms
- Homepage ~8s, Discover ~4s on production
- Cluster cards/badges linked to `/discover/projects-to-watch?cluster=` which only returns growing clusters → empty pages

## Fixes
1. Cluster browse/badge links → `/?cluster={slug}` (repo search already supports it); growth cards → `/discover/fastest-growing?cluster=`
2. Stop write-on-read in `getDiscoverySystemStatus`
3. Discovery cards read stored stories only (no generate-on-GET)
4. Short TTL caches for readiness, cluster analytics, daemon activity, enrich ops, missing-hour counts
5. Materialized landing uses `listActiveClusterSummaries` instead of N+1 analytics
6. SvelteKit preload `hover` → `tap`
