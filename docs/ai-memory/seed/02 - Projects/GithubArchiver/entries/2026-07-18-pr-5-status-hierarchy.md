---
id: decision-status-hierarchy
date: 2026-07-18
pr: 5
commit: 12f7ae4
area:
  - status-ui
  - daemon
  - search
type: decision
status: verified
confidence: confirmed
supersedes: null
related:
  - bugfix-activity-copy
  - pr-6
  - search-fallback
  - status-ui
title: Shared status hierarchy and clearer discovery/job semantics
migration: null
---

# PR #5 — Status semantics hierarchy

## Architecture

Shared UI structure: **Current activity → Progress → Discovery** (`StatusStory`).

Progress: Enriched / This run / Waiting (+ optional coverage).  
Discovery: latest completed archive hour, backlog, Search fallback, worker last ran.

## Other semantics

- Restart orphans → `interrupted` (not `failed`)
- Search labeled as historical discoveries vs active fallback
- Client-safe helpers in `status-display.ts` (not `$lib/server`)

## Production verification

- Activity bar and shared hierarchy look correct
- Discovery labels no longer compete
- Search fallback showed Yes during enrichment → led to PR #6
