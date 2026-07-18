---
date: 2026-07-18
pr: 6
commit: 10cdc46
area:
  - search
  - daemon
  - status-ui
type: incident
status: open
supersedes: null
title: Search fallback active must reflect live execution only
---

# PR #6 — Search fallback active accuracy

## Root cause

Search starts `search_ingest_stats` rows as `running`. Railway restarts mid-run. Daemon reconciles orphaned `job_runs`, but Search shard rows stay `running`. `isSearchFallbackActive()` treated those stale rows as active while the daemon enriched.

## Fix

- Reconcile orphaned Search stats on daemon start (same 10-minute orphan window)
- Age-floor in `isSearchFallbackActive`
- Discovery order: archive hour → archive backlog → worker last ran → Search fallback
- E2E startup regression via `ensureBackgroundWorker`

## Remaining verification (after deploy)

| Scenario | Search fallback |
| --- | :---: |
| Normal GH Archive ingest | No |
| Ordinary enrichment | No |
| Search actually executing | Yes |
| Stale rows after restart | No |
