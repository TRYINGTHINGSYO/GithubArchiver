---
id: incident-gharchive-createevent
date: 2026-07-17
pr: 3
commit: e5476ac
area:
  - search
  - search-fallback
  - discovery
  - ingest
  - migration
type: incident
status: merged
supersedes: null
related:
  - migration-030
  - search-fallback
  - pr-6
title: Fix GH Archive CreateEvent matching (0 repo creates bug)
migration: 30
---

# PR #3 — CreateEvent matching / Search-gap gating

## Root cause

After ~2025-10, GH Archive CreateEvents often have no `ref_type=repository` (only branch/tag). Matching on repository ref_type yielded 0 creates and incorrectly triggered Search fallback.

## Fix

- Match default-branch CreateEvents (`ref === master_branch`)
- Persist `matched_repo_creates` (migration 30)
- Search-gap gating uses matched creates, not raw event count
- Skip Search when prior pass ≥95% duplicates
