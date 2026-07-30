---
schema: 1
id: feature-running-job-age-homepage
date: 2026-07-30
area:
  - observability
  - daemon
  - ux
type: feature
status: open
confidence: confirmed
durability: release
relationships:
  - type: caused-by
    id: incident-daemon-ingest-hang
  - type: related
    id: bugfix-ingest-fetch-timeout
  - type: related
    id: bugfix-claimable-retry-hygiene
title: Surface longest running job_runs age on homepage Discovery panel
---

# Active job age on homepage

After the ingest hang, the wedge was only visible via SSH (`job_runs` + `worker.log`). Homepage now shows **Active job age** in the Discovery status block.

## Behavior

- `getLongestRunningWorkJobSnapshot()` — longest non-daemon `running` job (daemon excluded; it is always long-lived)
- Label: `ingest · 1h 15m` (plus `(N running)` when multiple)
- **stale** when age ≥ orphan floor (10m / `STALE_RUNNING_JOB_MS`) — amber + `· stale` suffix
- Same threshold as `reconcileOrphanedJobRuns`, so “stale on the homepage” ≈ “would be interrupted on restart”

## Files

- `src/lib/server/db/jobs.ts` — snapshot helpers
- `src/lib/components/StatusStory.svelte` — Discovery metric
- `src/routes/+page.server.ts` / `+page.svelte` — wire-up
- `tests/running-job-age.test.ts`
