---
id: bugfix-semantic-no-global-stale-on-worker-mismatch
date: 2026-08-20
area:
  - search
type: bugfix
status: open
confidence: confirmed
durability: release
schema: 1
relationships:
  - type: caused-by
    id: bugfix-semantic-search-release-correctness
  - type: related
    id: feature-semantic-search-turbovec
  - type: implemented-by
    id: pr-33
title: Do not globally stale semantic state on worker misconfig
---

## What

Removed `markSemanticStaleForIncompatibility`. On worker compatibility failure:

- unavailable → skip, no `semantic_index_state` mutation
- model/dims/bits/doc mismatch → targeted `markSemanticStaleForModelOrVersion` (stored row vs **app** config)
- schema mismatch → skip + rebuild hint, zero stale

Healthy rows matching app config stay `indexed` when the worker is accidentally wrong (e.g. hashing vs MiniLM), so a corrected worker resumes without re-embedding.

## Tests

497 passed. Compatibility A–E: wrong worker+healthy DB, unavailable, mixed rows, app config change, schema rebuild.
