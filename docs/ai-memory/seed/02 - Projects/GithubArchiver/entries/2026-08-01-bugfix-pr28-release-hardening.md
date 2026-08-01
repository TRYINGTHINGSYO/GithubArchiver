---
id: bugfix-pr28-release-hardening
date: 2026-08-01
pr: 28
area:
  - websites
  - schema
  - collections
type: bugfix
status: open
confidence: confirmed
durability: release
schema: 1
migration: 44
relationships:
  - type: implemented-by
    id: pr-28
  - type: references
    id: feature-intelligence-discovery-redesign
title: PR #28 release-blocking hardening for ratings and domains
---

## What

Release review fixes before merging the discovery redesign foundation:

- Rating upsert/delete + aggregate recompute run in one SQLite transaction
- Route/API domain params normalized via `parseWebsiteRouteDomain` (reject path/`..`/IP)
- `websiteVisitHref` allows only `http:` / `https:`
- Integer 1–5 + review length validation at API
- Dual-write delete consistency tests; empty/hidden/dead random handling
- Documented dual-write source of truth, rollback, and retirement path in redesign plan

## Why

Prevent aggregate races, open-redirect-ish visit URLs, and ambiguous dual-write semantics before schema 44 lands in production.
