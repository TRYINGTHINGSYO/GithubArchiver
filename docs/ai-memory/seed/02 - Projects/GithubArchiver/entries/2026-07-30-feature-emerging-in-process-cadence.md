---
id: feature-emerging-in-process-cadence
date: 2026-07-30
area:
  - emerging
  - daemon
type: feature
status: verified
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: caused-by
    id: incident-emerging-never-scheduled
title: Wire emerging into in-process daemon on own cadence
---

## What

Emerging topic detection now runs from the live in-process daemon (`background-daemon.ts`) via `daemon-cadence.ts` → `runScheduledJob('emerging', runEmergingTopicCycle)`.

## Why

Gates were already ready (`emergingDetectionReady: true`); production never called the job because only `scripts/daemon.ts` scheduled it, and Railway runs BACKGROUND_WORKER → in-process planner.

## Design decisions

1. **Own cadence** — `DAEMON_EMERGING_INTERVAL_MS` (default 3h) via `scheduled_jobs.next_run_at`. Not a planner action; cannot starve ingest/enrich the way raw unenriched scoring did. After one success/failure, `next_run_at` advances (failure uses backoff).
2. **Reuse** — same `runScheduledJob` + `runEmergingTopicCycle` path; no gate/detection reimplementation.
3. **Order** — cadence runs *after* the planner backlog action each loop, so a never-run row cannot steal the first cycle from ingest/enrich.
4. **`scripts/daemon.ts`** — kept for local/offline full-pipeline experiments; documented as non-production with a startup warning. New production features go in `daemon-cadence` / `background-daemon`.

## Tests

`tests/daemon-cadence.test.ts` — due once → completes → not due on subsequent loops; `shouldSkip` respected.

## Remaining verification

Deploy and confirm prod `scheduled_jobs.emerging` gets a row, `last_emerging_analysis_at` updates after first due pass, and ingest/enrich continue between 3h windows.
