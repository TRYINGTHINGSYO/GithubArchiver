---
schema: 1
id: incident-emerging-never-scheduled
date: 2026-07-30
area:
  - emerging-topics
  - daemon
  - discovery
type: incident
status: open
confidence: confirmed
durability: permanent
relationships:
  - type: related
    id: incident-freshness-stall
  - type: related
    id: feature-running-job-age-homepage
title: Emerging topics never ran — in-process daemon has no emerging action
---

# Emerging detection: scheduling gap, not gate failure

## Verdict

**Bucket: genuine scheduling gap.** Absolute gates (≥10 repos / ≥5 owners / ≥3 high-signal) were never the blocker — detection has never been invoked in production.

## Evidence (prod 2026-07-30)

| Signal | Value |
| --- | --- |
| `emerging_detection_runs` | **0** |
| `emerging_topics` | **0** |
| `discovery_system_status.last_emerging_analysis_at` | **null** |
| `scheduled_jobs` rows | **empty** (in-process path never calls `initializeDaemonScheduler`) |
| Homepage copy | "First analysis is scheduled by the discovery worker" (shown when `lastEmergingAnalysisAt` is null) |

Earlier readiness probe already had `emergingDetectionReady: true` — volume gates would pass if detection ran.

## Architecture split

1. **Standalone** `scripts/daemon.ts` (`npm run daemon`) — uses `getDueDaemonJobs` / `runScheduledJob` and **does** call `runEmergingTopicCycle` every `DAEMON_EMERGING_INTERVAL_MS` (default 3h).
2. **In-process** `background-daemon.ts` (what Railway runs via `start:server` → `hooks.server.ts` → `ensureBackgroundWorker`) — planner actions are only `ingest | enrich | refresh | archive | search_gap | backfill | idle`. **No `emerging`, no `discovery` schedule loop.**

Production uses path (2). Emerging worker code exists and is reachable from CLI/`npm run detect:emerging`, but nothing in the live loop schedules it.

## Fix direction (not applied yet)

Wire emerging (and likely discovery materialization if still orphaned from the same split) into `background-daemon` — either as a planner action with interval, or by adopting `runScheduledJob('emerging', …)` alongside backlog actions — without letting it starve ingest/enrich.

Do **not** loosen absolute gates first; they were never exercised.
