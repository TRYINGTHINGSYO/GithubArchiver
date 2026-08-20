---
id: bugfix-semantic-search-release-correctness
date: 2026-08-20
area:
  - search
  - sqlite
type: bugfix
status: open
confidence: confirmed
durability: release
schema: 1
relationships:
  - type: caused-by
    id: feature-semantic-search-turbovec
  - type: related
    id: bugfix-semantic-search-release-hardening
  - type: implemented-by
    id: pr-33
title: Semantic eligibility, reconcile cursor, and worker compatibility
---

## What

Three remaining release-correctness fixes on PR #33 (no redesign):

1. Every TurboVec semantic/hybrid hit is filtered through `filterRepoIdsByQuery` → `buildRepoFilters` baseline visibility (`deleted_at` / `pending_deletion_at`), even with no user hard filters.
2. Reconciliation uses persisted `vector_id` keyset cursors (`semantic_reconcile_cursor`, migration 048) with wraparound — eventual coverage of all indexed/removed rows; no `updated_at` starvation / no OFFSET.
3. Centralized `checkWorkerCompatibility` validates model, dimensions, bits, schemaVersion, and semanticDocumentVersion for search, indexing, similar-repos, and admin stats. Schema mismatches require rebuild; other mismatches mark rows stale.

Also added optional `npm run semantic:eval:prod` (MiniLM meaning fixtures).

## Tests

492 passed. New: eligibility deleted/pending, reconcile progress, compatibility mismatches (5 fields), migration 048.

Worker smoke / restart persistence / removal-only persistence OK.

MiniLM prod eval (when installed): keyword R@10=0; semantic/hybrid R@10=1, MRR=1 on meaning fixtures.

## Remaining

- Website entity semantic indexing still future work
- Live Railway MiniLM quality on the full archive still needs a production run
- Do not merge until human review
