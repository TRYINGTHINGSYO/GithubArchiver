---
schema: 1
id: incident-daemon-ingest-hang
date: 2026-07-30
area:
  - daemon
  - discovery
  - enrichment
  - observability
type: incident
status: open
confidence: confirmed
durability: permanent
relationships:
  - type: caused-by
    id: incident-freshness-stall
  - type: related
    id: incident-enrichment-hourly-bottleneck
  - type: related
    id: incident-search-fallback-stale
title: Daemon alive but wedged — empty enrich spin then hung ingest (no fetch timeout)
---

# Daemon #1 verdict: not dead — spinning then hung

Production SSH + `/data/worker.log` + `job_runs` probe on 2026-07-30.

## Verdict

| Hypothesis | Result |
| --- | --- |
| Process dead / not scheduled | **No** — Railway Online; daemon job `#287673` running since 2026-07-27 (`pid` 50) |
| Classic claim-lock wedge | **No** — `claimed` alive = 0; claims use TTL |
| GitHub rate-limit stall | **No** — `rateLimitResetAt` null; readiness `hasGitHubAuth: true` |
| Stale “last ran” timestamp | **No** — `worker_progress.updated_at` is a live write-only clock |
| Stale throughput (25.9/min) | **Yes** — last-cycle fallback when hour window is 0 |
| Currently making progress | **No** — wedged |

## What is actually happening

### Phase A — empty enrich spin (~03:37 → 08:00 UTC)

- Last real enrich success: **2026-07-30T03:37:48Z** (8 repos) — matches dashboard “enrichment last ran”.
- After that, daemon loop: `decision → enrich` → **`0 enriched` in ~0s** → sleep **2000ms** → repeat.
- `worker.log` has **~360k** `0 enriched` lines.
- Cause: planner scores on **`unenriched` (~1.07M, almost all deferred)**, but `claimEnrichmentBatch` only takes claimable pending/retry under `ENRICH_RETRY_LIMIT` (5).
- At spin time the only retries were **283 rows all at attempts=5** (terminal for claim). Many have **empty** `last_enrichment_error`; 27 say `cycle budget exceeded before start`.
- `ENRICH_BACKLOG_SLEEP_MS=2000` keeps the loop hot because `unenriched >= threshold`, so the daemon burns cycles without claiming.

### Phase B — hung ingest (08:00:06 UTC → still open at probe ~09:15)

- Decision: `131 missing GH Archive hour(s) → ingest`.
- `job_runs`:
  - `#363958` ingest `running` since 08:00:06.185Z
  - `#363959` ingest `running` since 08:00:06.189Z (`hours_planned: 6`)
  - Daemon detail `phase: ingest`, `loop_started: 08:00:05`
- **No further `worker.log` lines** after the decision (ingest completion log never written).
- Hang age at probe: **~75 minutes**.
- `gharchive.ts` `fetch(url)` has **no AbortSignal / timeout** — network stall can wedge the whole single-threaded daemon loop.
- Latest `ingestion_state` hour still `2026-07-24-20` (touched `ingested_at=08:57:29Z` during this job) — has not advanced the frontier past the known lag tip.

## Dashboard signal quality (your checklist)

1. **`enrichment last ran`** — honest. Direct `worker_progress.updated_at` from `setEnrichmentProgress`. Not a throughput-style fallback.
2. **`job_runs` stuck `running`** — confirmed (ingest, not enrich claim locks).
3. **Railway restart around 5h mark** — **not** the cause. Last deploy 2026-07-24; daemon continuous since 07-27. The 5h mark is when enrich last *succeeded*, not when the process died.
4. **Rate limit** — not implicated right now.

## Why #2 (archive lag) is downstream of this

Ingest score (~281) and enrich score (~280) are nearly tied when both backlogs are huge. Empty enrich spin + 2s sleeps delayed ingest for hours; when ingest finally won, the **no-timeout fetch** hung the loop so neither ingest nor enrich can proceed.

## Fix direction (not applied yet)

1. **Unstick now:** restart the Railway service (reconcile orphaned `running` ingest/daemon rows on boot) — ops only, needs explicit go-ahead.
2. **Hardening:** AbortSignal timeout on GH Archive `fetch`; max wall-clock for `runIngestCycle`; heartbeat logs per hour.
3. **Planner:** score enrich on **claimable** backlog (or treat attempt-exhausted as non-work), not raw `unenriched`.
4. **Observability:** don’t show last-cycle throughput when `enrichedLastHour=0`; surface `job_runs.running` age on the homepage.
5. **Retry hygiene:** attempt-exhausted retries with empty error should not sit forever as fake claimable/ETA inventory.

## Restart verification (2026-07-30T09:23Z)

- Pre-check: `reconcileOrphanedJobRuns` is real — marks `running` older than 10m as `interrupted`; unit-tested in `tests/orphan-jobs.test.ts`; called from `ensureBackgroundWorker` on boot.
- `railway restart -y` → log: `reconciled 3 orphaned job_run(s)` then `daemon started in-process (pid 50)`.
- `#363958`, `#363959`, `#287673` → **`interrupted`** with `orphaned: process restarted mid-run` (not left as zombie `running`).
- New daemon `#363960` started; first enrich cycle after restart: **23 enriched** (claimable pending draining again).
- During the long ingest job, frontier did advance once to `2026-07-24-21` (`ingested_at=09:16:10Z`) — favors **slow/hung network read** over a hard SQLite write-lock (lock would not finish an hour). Fetch timeout still the right first hardening; still add per-hour heartbeat.

## Coverage / retry hygiene note

Homepage Coverage used `enriched / (enriched + worker_progress.remaining)`. At stall, `remaining` was stuck at **283** (all attempt-exhausted retries). `41867/(41867+283) ≈ 99.3%` — so that number was partly “dead-end retries,” not healthy claimable queue. `countClaimableEnrichmentBacklog` does **not** filter `attempts < ENRICH_RETRY_LIMIT`.
