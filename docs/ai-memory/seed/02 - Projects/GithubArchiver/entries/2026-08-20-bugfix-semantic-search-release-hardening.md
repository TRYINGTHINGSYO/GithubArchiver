---
id: bugfix-semantic-search-release-hardening
date: 2026-08-20
area:
  - search
  - enrichment
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
    id: feature-semantic-search-turbovec
title: Harden TurboVec semantic search before merge (BM25, durability, backfill)
---

## What

Release-blocking fixes on PR #33:

1. FTS5 BM25 conversion uses `-bm25` (negative scores are normal; no Math.max(0) collapse)
2. Index/delete durability: TurboVec `sync()` before SQLite `indexed`/`removed`
3. Removals-only cycles always durable-sync
4. Backfill uses LEFT JOIN for missing/stale state (no newest-first starvation)
5. Large-filter fallback post-filters TurboVec candidate IDs with complete SQL
6. Production embedder install path (`requirements-prod.txt`); hashing labeled CI-only
7. Startup reconciliation for indexed-missing / removed-present vectors
8. Explicit candidate-window pagination semantics
9. Benchmarks cover 2/3/4-bit at 10k and 100k

## Tests

471 passed. New: FTS5 BM25 integration, durability order, sync-failure retry, removals-only, backfill starvation, large-filter fallback.

## Remaining

- Website entity backfill still future work
- Production MiniLM quality on the live archive still needs a real Railway run
