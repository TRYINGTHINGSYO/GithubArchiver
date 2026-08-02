---
id: feature-intelligence-discovery-redesign
date: 2026-08-01
pr: 28
commit: cbb7d80
area:
  - ui
  - websites
  - collections
  - schema
type: feature
status: open
confidence: confirmed
durability: release
schema: 1
migration: 44
relationships:
  - type: implemented-by
    id: pr-28
  - type: references
    id: feature-website-discovery-v1
title: Dual discovery redesign — shell, ratings, random websites
---

## What

First PR slice of the repository intelligence + website discovery redesign.

- Audit plan: `docs/product/redesign-plan-2026-08.md`
- Three-column shell (left nav / center / right rail), theme modes
- Migration **044**: website ratings, user shown/hidden state, polymorphic `collection_items` (backfill from `collection_repositories`)
- Website cards, detail (`/websites/[domain]`), random mode with keyboard shortcuts
- Independent website favorites (system collections); Bayesian rating aggregates
- Homepage interleaves new/highest-rated websites with repo discovery

## Why

Product brief requires repositories and websites as equal discovery surfaces. Prior UI was repo-primary with websites as a thin live list.

## Tests

- `tests/website-curation.test.ts` — schema 44, ratings, independent favorites, random recently-shown avoidance
- Existing website-discovery, collections, production-migrate (drift-safe 044)

## Remaining

Screenshots, admin rating moderation UI, unified search tabs, README navigator, similarity explanations, virtualization, full E2E browser path.
