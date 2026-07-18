---
id: incident-backlog-sleep-tiers
date: 2026-07-17
pr: 2
commit: 269732c
area:
  - daemon
  - enrichment
  - migration
type: incident
status: merged
supersedes: null
related:
  - migration-029
  - daemon
  - enrichment
title: Fix backlog-sleep 300s stall and all-urgent enrichment tiers
migration: 29
---

# PR #2 — Backlog sleep + enrichment tiers

## Root cause

Daemon slept `300000ms (backlog-sleep)` while ~670k repos looked urgent because tier recomputation and sleep defaults were wrong.

## Fix

- `computeDaemonSleepMs`: backlog sleep = `min(sleepMinMs, ARCHIVE_BACKLOG_SLEEP_MS)`
- Schema v29: recompute enrichment tiers so not everything is urgent
- Defaults/docs aligned with 30s–120s sleep
