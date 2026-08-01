---
id: bugfix-ghost-cluster-eligibility
date: 2026-08-01
pr: null
commit: null
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
  - type: related
    id: bugfix-cluster-wipe-empty-state
  - type: caused-by
    id: feature-durable-discovery-materialization
  - type: references
    id: architecture-review-delta-pr28
title: Shared public cluster eligibility and generation-gated materialization
---

## What

Hardened the PR #30 wipe fix with a single `isPublicClusterEligible` / `hasPublicClusterIntelligenceEvidence` predicate, a live membership generation fingerprint (`cluster_intelligence_meta`, migration 044), and per-card revalidation of materialized cluster payloads. Taxonomy/`CLUSTER_DEFINITIONS` seeding is unchanged and must never appear as live discovery cards.

## Root cause (combination)

Ghost cards came from a **combination** of:

1. **Stale materialized discovery records** (`discovery_fastest_clusters`) served without membership gates (primary; addressed in PR #30).
2. **Process-local TTL** (`cluster-analytics`) surviving DB reopen (addressed in PR #30).
3. **Zero-membership analytics / registry adjacency** — `ensureClusterRegistry` seeds `repo_clusters` with `repo_count = 0`; loaders must not treat those as intelligence.
4. **Insufficient shared eligibility** — slightly different checks across loaders; materialized rows not revalidated against live thresholds/generation after membership churn.

## Why

Public discovery surfaces must emit cluster intelligence only when current DB memberships + current materialization generation qualify. Definitions remain available for classification/admin.

## Tests

- `tests/cluster-eligibility.test.ts` — predicate + empty→populated→empty cycle
- Existing `tests/cluster-wipe-empty-state.test.ts` remains green
