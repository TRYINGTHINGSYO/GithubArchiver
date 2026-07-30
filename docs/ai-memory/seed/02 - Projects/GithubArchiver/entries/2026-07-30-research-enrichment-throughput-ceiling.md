---
schema: 1
id: research-enrichment-throughput-ceiling
date: 2026-07-30
area:
  - enrichment
  - roadmap
type: research
status: open
confidence: confirmed
durability: temporary
relationships:
  - type: related
    id: incident-enrichment-hourly-bottleneck
  - type: related
    id: research-archive-backlog-pace
  - type: related
    id: debt-github-token
  - type: related
    id: bugfix-dashboard-trust-semantics
title: Enrichment throughput, not ingest, is the constraint on every downstream feature
migration: null
---

# Enrichment throughput ceiling (measured 2026-07-30 ~21:30Z)

Live production, daemon healthy and actively enriching:

| Signal | Value |
| --- | --- |
| Total repos | 1,169,184 |
| Enriched | 46,118 (3.9%) |
| Unenriched backlog | 1,123,066 |
| Enriched last hour | 249 |
| Avg seconds / repo | 11.24 |
| Archive hour backlog | 116 |

## The arithmetic

At 249 repos/hour the existing backlog needs ~4,510 hours — **roughly 188 days** —
and that ignores the ~1,000+ new repos arriving per ingested archive hour. 11.24s per
repo implies effectively serial processing; the theoretical ceiling at concurrency 1 is
~320/hour.

Ingest is no longer the bottleneck. Archive lag moved 129h → 116h over ~12.4 wall
hours (≈2.05 archive-hours per wall-hour, versus the 2.4 baseline in
`research-archive-backlog-pace`; several deploys landed inside that window, so this is
not a clean measurement and the sticky-hour backoff cannot yet be credited or blamed).

## Why this gates the roadmap

Enrichment is upstream of nearly every proposed feature:

- Emerging topics: current-window enriched coverage is 8%, and growth is separately
  suppressed by hour coverage (see `bugfix-dashboard-trust-semantics`).
- Scoring / clustering / archive stories only exist for enriched repos.
- Any opportunity or momentum score would therefore describe ~3.9% of the corpus while
  presenting itself as a view of the whole.

Building a ranking layer before raising this ceiling produces a confident-looking score
over a 4% sample — the same false-precision failure as `Coverage 100%`, one layer up.

## Candidate levers — not yet investigated

- Concurrency: 11.24s/repo serial suggests headroom, bounded by GitHub rate limits.
- Tiering: does full Level-1 enrichment need to precede scoring, or can a cheap
  event-derived score cover the unenriched majority?
- Selectivity: enriching 1.12M repos may be the wrong goal versus enriching the repos
  that could plausibly matter.

Next step is measurement (rate-limit headroom and actual concurrency), not a fix.
