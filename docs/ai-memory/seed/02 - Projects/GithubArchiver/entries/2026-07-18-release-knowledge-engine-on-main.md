---
schema: 1
id: release-knowledge-engine-on-main
date: 2026-07-18
pr: 13
commit: 603a5c9
area:
  - memory
  - adoption
type: release
status: merged
confidence: confirmed
durability: permanent
relationships:
  - type: implemented-by
    id: pr-13
  - type: references
    id: feature-stabilize-retrieval
  - type: related
    id: incident-search-fallback-stale
related:
  - feature-stabilize-retrieval
  - memory
title: Knowledge engine adopted on main (PRs #6–#13)
migration: null
---

# Release — knowledge engine on main

Merged to `main`:

- **PR #6** — Search fallback active accuracy (product fix)
- **PR #7** — Cursor rules + seed vault
- **PR #13** — full knowledge-engine stack (#8–#13) retargeted and merged

Intermediate stacked PRs #8–#12 closed as superseded by #13.

## Adoption mode (next milestone)

Use during normal GithubArchiver work. When retrieval over-returns, misses, or ranks oddly:

1. Note the query and expected ids
2. Add a case under `docs/ai-memory/evals/`
3. Append a durable entry only for confirmed outcomes

Do not invent more retrieval features until the eval corpus grows from real tasks.
