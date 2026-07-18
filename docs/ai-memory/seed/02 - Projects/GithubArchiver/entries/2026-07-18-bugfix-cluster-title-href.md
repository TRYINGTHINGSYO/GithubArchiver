---
schema: 1
id: bugfix-cluster-title-href
date: 2026-07-18
pr: null
commit: null
area:
  - discovery
  - clusters
  - ux
type: bugfix
status: open
confidence: confirmed
durability: release
relationships:
  - type: caused-by
    id: bugfix-nav-perf-clusters
title: Homepage cluster titles must open /?cluster= not fastest-growing
migration: null
---

# Homepage cluster titles must open /?cluster=

PR #23 routed `mode === 'growth'` titles to `/discover/fastest-growing?cluster=…`. That page applies strict growth guardrails per request, so a homepage card (e.g. Portfolio Websites) could open an empty “No clusters meet the growth guardrails” page.

## Fix
- Cluster title always → `/?cluster={slug}` (repositories in the cluster)
- Optional secondary “View growth analysis” only when `isVerifiedGrowth`
