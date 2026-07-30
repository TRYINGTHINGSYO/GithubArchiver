---
id: research-archive-backlog-pace
date: 2026-07-30
area:
  - ingest
  - planner
  - gharchive
type: research
status: open
confidence: confirmed
durability: temporary
schema: 1
relationships:
  - type: caused-by
    id: incident-freshness-stall
  - type: related
    id: bugfix-ingest-fetch-timeout
  - type: related
    id: bugfix-periodic-job-reconcile
title: Post-fix backlog pace — catching up slowly; planner weight not the bottleneck
---

## Snapshot (prod 2026-07-30 ~18:45 UTC, after `3b4a568`)

- Latest ingested hour: `2026-07-25-20` (~118h lag vs current UTC hour)
- Orphans `#364182/183/184` cleared at boot (`interrupted: process restarted mid-run`)
- Emerging has run (`last_emerging_analysis_at` set)
- No stuck running ingest wrappers; live work is enrich/ingest cycling normally

## Pace (unmasked)

Hours completed by `ingested_at` since timeout deploy (~10:04 UTC): **21** over ~8.7 wall hours ≈ **~2.4 archive-hours / wall-hour**.

Bucketed (UTC): 11→2, 12→5, 13→1, 14→4, 15→5, 16→1, 17→1, 18→2. Spiky, not stalled.

At >1 archive-hour per wall-hour, lag is shrinking. At ~2.4/hr net, ~118h lag ≈ **~3–4 days** to catch up if pace holds — not a wedge, not "ingest never runs."

## What is still burning cycles

Sticky holes `2026-07-25-18` and `-19` are **not** in `ingestion_state`. Every cycle retries them; they fail with `GhArchiveTimeoutError` (30s) and stay missing (timeout ≠ unavailable cooldown). Later hours in the same 6-hour batch can still succeed (how `-20` landed).

Planner already prefers ingest (`score = 150 + missingHours` ≈ 267). **Shelved "weight large gaps higher" is not the next lever** — ingest already wins every decision. The macro drag is per-hour fetch reliability under the 30s ceiling from EU, plus no cooldown for timeout failures (unlike 404 unavailable).

## Next levers (not done)

1. Timeout-failure cooldown / skip-sticky so one slow hour can't consume 2/6 batch slots every loop
2. Revisit `GH_ARCHIVE_FETCH_TIMEOUT_MS` as a **catch-up throughput** knob (distinct from the hang bug — do not frame as re-widening a hang fix)
3. Open `incident-search-fallback-stale` separately — still unexplained UI signal
