---
schema: 1
id: incident-freshness-stall
date: 2026-07-30
area:
  - discovery
  - enrichment
  - daemon
  - observability
  - emerging-topics
type: incident
status: open
confidence: confirmed
durability: permanent
relationships:
  - type: related
    id: incident-enrichment-hourly-bottleneck
  - type: related
    id: incident-search-fallback-stale
  - type: related
    id: decision-enrich-stage-timings
  - type: related
    id: debt-github-token
title: Production freshness stall — archive ~5–6 days behind, enrich idle, emerging never ran
---

# Production freshness stall (dashboard triage 2026-07-30)

Live homepage review on [production](https://new-production-9120.up.railway.app/) shows classification/story/cluster surfaces healthy, but **freshness** is not.

## Observed (production, ~2026-07-30)

| Signal | Value |
| --- | --- |
| Latest completed archive hour | `2026-07-24-20` |
| Archive backlog | **129 hours** (~5.4 days) |
| Enriched last hour | **0** |
| Enrichment last ran | **~5 hours ago** |
| Shown throughput | **25.9 repos/min** (stale — contradicts last-hour = 0) |
| Claimable queue | ~980 (ETA ~38 min if throughput were real) |
| Deferred metadata-only | ~1.08M |
| Emerging active candidates | **0** + copy "First analysis is scheduled by the discovery worker" |
| Snapshot coverage | **3.7%** (41,867 / ~1.12M) |
| Enrichment panel Coverage | **99.3%** (claimable-queue framing, unlabeled) |
| Stories / classified | 38,561 / 41,867 (~92%) — healthy |
| Unusual finds | ohmyzsh, playwright, laravel — correct high-score / no-cluster cases |

## What is working

- Story generation keeps pace with classification.
- Unusual-finds and cluster-growth lanes look evidence-backed, not placeholder.
- Intelligence pipeline (classify → cluster → score → story) is not the bottleneck.

## Confirmed code smells (not yet root-caused)

1. **Stale throughput display.** `computeEnrichmentOpsSnapshot` falls back to last-cycle `throughput_per_min` when minute and hour windows are empty — so idle daemon still shows ~25.9/min.
2. **Dual “coverage” labels.** Snapshot = enriched/indexed corpus; Progress Coverage = enriched/(enriched+claimable-ish). Same word, different denominators.
3. **Avg vs P50 mismatch is expected given dual populations.** Cycle `avg_*` overwrites from the last enrich cycle; P50/P95 come from a process-local rolling window (`n=2000`). Avg ≪ P50 does not by itself prove broken aggregation.
4. **Emerging topics never completed a detection run** (homepage still shows pre-first-run copy).

## Audit priority (bump to top)

1. **Is the daemon actually stalled / dead / stuck in a non-progress loop?** (enrich last ran hours ago + archive not advancing)
2. **Why is GH Archive ingest ~129 hours behind?** Planner should prefer ingest when `missingGhArchiveHours` is large — verify whether ingest is failing, blocked, or never scheduled.
3. Label / compute live-vs-stale throughput and distinguish corpus vs claimable coverage in the UI.
4. Confirm emerging-topic detection is scheduled and not gated forever on incomplete windows.

## Remaining verification

- Railway process health / daemon logs / latest `job_runs`
- Whether ingest errors, rate limits, or planner sleep explain the 5-day archive lag
- Whether `detectEmergingTopics` / discovery worker has ever succeeded in prod
