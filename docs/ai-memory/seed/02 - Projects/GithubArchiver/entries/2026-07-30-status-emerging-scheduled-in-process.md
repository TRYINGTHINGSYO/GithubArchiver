---
id: status-emerging-scheduled-in-process
date: 2026-07-30
area:
  - emerging
  - daemon
type: feature
status: done
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: supersedes
    id: incident-emerging-never-scheduled
  - type: implemented-by
    id: feature-emerging-in-process-cadence
title: Emerging scheduling gap closed in production path
---

Incident `incident-emerging-never-scheduled` is addressed: production BACKGROUND_WORKER now schedules emerging via in-process cadence. Absolute gates unchanged. Remaining check is post-deploy: `last_emerging_analysis_at` and `scheduled_jobs.emerging` populate without starving ingest/enrich.
