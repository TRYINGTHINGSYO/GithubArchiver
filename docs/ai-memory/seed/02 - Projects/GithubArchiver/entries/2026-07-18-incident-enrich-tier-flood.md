---
schema: 1
id: incident-enrich-tier-flood
date: 2026-07-18
pr: null
commit: null
area:
  - enrichment
  - priority
  - throughput
type: incident
status: open
confidence: confirmed
durability: permanent
supersedes: null
relationships:
  - type: caused-by
    id: incident-enrichment-hourly-bottleneck
  - type: related
    id: incident-backlog-sleep-tiers
related:
  - incident-enrichment-hourly-bottleneck
  - incident-backlog-sleep-tiers
title: Bulk ingest marked ~all repos high tier and forced deep enrich
migration: 31
---

# Incident — Enrichment tier flood after bulk ingest

## Symptom (production 2026-07-18)

After continuous-enrich shipped: ~34 repos/min, GitHub auth OK (4189/5000 remaining), but:

- `enrichment_tier`: ~796k **high**, 0 deferred
- Every high repo took **deep** enrich (~3 API requests)
- Claimable queue ≈ total unenriched; ETA ~16 days
- Railway still had `ENRICH_CONCURRENCY=6` / `ENRICH_BATCH_SIZE=40`

## Root cause

`assignEnrichmentTier` treated `seenAgeDays <= 2` as **high**. Bulk ingest discovers hundreds of thousands of old repos in a short window, so nearly the entire backlog became high. `shouldDeepEnrich` then deep-enriched all high tiers.

## Fix

1. Tier by **created_at** (+ stars/signal), not recently-seen alone.
2. Defer old zero-signal long-tail (`migration 031` recompute).
3. Deep enrich only for urgent / high-signal — bulk high uses **fast** (1 request).
4. Prefer `ENRICH_WORKER_CONCURRENCY` / `ENRICH_WORKER_BATCH_SIZE` so stale Railway env cannot pin 6×40.
