---
schema: 1
id: incident-empty-createevent-defer
date: 2026-07-18
pr: null
commit: eb58221
area:
  - enrichment
  - priority
type: incident
status: open
confidence: confirmed
durability: permanent
supersedes: null
relationships:
  - type: caused-by
    id: incident-enrich-tier-flood
  - type: related
    id: incident-enrichment-hourly-bottleneck
related:
  - incident-enrich-tier-flood
  - incident-enrichment-hourly-bottleneck
title: Defer empty CreateEvent spam — backlog is days-old births not years-old repos
migration: 32
---

# Incident — Empty CreateEvent deferral

## Symptom after #20

Throughput healthy (~43/min, concurrency 8, 1 req/repo) but **Deferred stayed 0** and claimable stayed ~795k. ETA still ~13 days.

## Root cause

`oldestWaitingAt` ≈ 2026-07-14 — the unenriched backlog is almost entirely repos **created in the last few days** via GH Archive CreateEvents. Age-based deferral (`created > 180d`) never fires. Unconditional `createdAge <= 7 ⇒ high` kept the empty CreateEvent flood on the claimable queue.

## Fix

- Empty new creates (0 stars, no real description, no signal) → **deferred** (metadata-only, no GitHub API)
- High/urgent requires stars or real signal even for brand-new repos
- Milder recency priority boost
- Migration **32** recomputes the live backlog
