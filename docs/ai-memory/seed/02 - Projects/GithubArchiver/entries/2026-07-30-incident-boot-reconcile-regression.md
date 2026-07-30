---
schema: 1
id: incident-boot-reconcile-regression
date: 2026-07-30
area:
  - daemon
  - deploy
type: incident
status: verified
confidence: confirmed
durability: permanent
relationships:
  - type: caused-by
    id: bugfix-deploy-healthcheck-race
  - type: related
    id: bugfix-periodic-job-reconcile
  - type: related
    id: incident-daemon-ingest-hang
title: The healthcheck delay silently regressed the boot-reconcile guarantee
migration: null
---

# Boot reconcile regressed by the deploy-healthcheck fix

`bugfix-periodic-job-reconcile` established the invariant that a fresh process
reclaims **every** leftover `running` row at boot (`maxAgeMs = 0`), because the new
process cannot have created any of them. That was the correction for the 10-minute age
floor which left ingest #364183/#364184 stuck for 8 hours.

`bugfix-deploy-healthcheck-race` then moved `reconcileOrphanedJobsOnce()` inside the
`BACKGROUND_WORKER_DELAY_MS` timer *and* behind the `enabled && !running` gate. Two
consequences, neither intended:

- Boot reconciliation was delayed 15s and became conditional on the daemon being
  enabled, so a web-only or daemon-disabled process never reclaimed orphans at all.
- `tests/search-fallback-active.test.ts` began failing: `ensureBackgroundWorker()` no
  longer reconciles synchronously, so a planted 20-minute-old `running` Search shard
  stayed `running`.

The reasoning error was treating reconciliation as daemon *work*. It is a local
`UPDATE` on `job_runs` / `search_ingest_stats` that issues no network calls, so it was
never what threatened `/api/health` — the ingest cycle was.

## Fix

`reconcileOrphanedJobsOnce()` now runs synchronously in `ensureBackgroundWorker()`
after the `isDatabaseReady()` check, independent of both the delay and the enabled
gate. The delay still wraps `startBackgroundDaemon()` only, so the healthcheck
protection is unchanged.

## Lesson

This is the second time in one day that a fix for one failure quietly weakened a
different fix's guarantee. The failing test was the only thing that surfaced it —
the production symptom (orphans lingering an extra 15s) would have been invisible
until the next crash-deploy.
