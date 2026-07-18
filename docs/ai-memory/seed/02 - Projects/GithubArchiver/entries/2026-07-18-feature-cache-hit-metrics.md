---
schema: 1
id: feature-cache-hit-metrics
date: 2026-07-18
pr: 24
commit: 99dab1d
area:
  - performance
  - observability
  - admin
type: feature
status: open
confidence: confirmed
durability: release
relationships:
  - type: caused-by
    id: bugfix-nav-perf-clusters
title: Admin request-path cache hit-rate metrics
migration: null
---

# Admin request-path cache hit-rate metrics

After PR #23 removed write-on-read and added short TTL caches, the next evidence signal is whether those caches are actually warm.

Admin → Discovery pipeline now shows per-group hit rate, miss rate, lookup count, and average live entry age for:

- Homepage (`data-readiness`, enrich ops, missing hours)
- Cluster analytics
- Activity bar

Process-local; resets on deploy. Target after warm-up: **≥90% hit rate** on homepage/cluster groups. If hit rates stay high but pages are still slow, profile SQLite next (top queries by total time, P95, rows scanned).
