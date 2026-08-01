---
id: architecture-review-delta-pr28
date: 2026-08-01
pr: null
commit: 69e6d37
area:
  - architecture
  - security
  - websites
  - clusters
  - schema
type: decision
status: open
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: references
    id: feature-intelligence-discovery-redesign
  - type: references
    id: bugfix-pr28-release-hardening
  - type: related
    id: bugfix-cluster-wipe-empty-state
title: Architecture review updated against PR #28 (schema v44)
---

## What

Re-ran the architecture review against PR #28 head (`cursor/intelligence-discovery-redesign-1514` @ `2b77ed9`) instead of the stale v13 export / `main`-only workspace. Produced delta review, verification results, empty-volume defect report, mutation inventory, fix packets 01–10, and PR sequence under `docs/architecture-review/`.

## Why

The prior review claimed schema v13 and absence of website ratings/favorites/collections/random UI. Those conclusions are false on the PR #28 line (`CURRENT_SCHEMA_VERSION = 44`, migration 044, three-column shell).

## Key remaining risks

- **P0:** CSRF/origin missing; default admin password; ungated `/api/repo/save`, emerging POST, bulk export GET
- **P1:** compare-readme missing imports; `sourceAnalysis: null`; one-shot archive refresh; empty-volume stale cluster materialization (fix on `main` as `2c5b89f` / PR #30, not on PR #28 head)
- Verification: `npm run build` 0, `npm test` 0 (361), `tsc --noEmit` 2 with 63 errors

## Next

Implement fix packet 01 (admin auth + mutation security) as the first application PR. Do not treat the v13 export docs as authoritative for website/cluster presence.
