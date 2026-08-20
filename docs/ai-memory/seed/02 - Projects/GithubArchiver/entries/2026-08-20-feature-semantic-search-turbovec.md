---
id: feature-semantic-search-turbovec
date: 2026-08-20
area:
  - search
  - enrichment
  - sqlite
type: feature
status: open
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: references
    id: decision-knowledge-engine-philosophy
  - type: related
    id: feature-intelligence-discovery-redesign
title: TurboVec semantic search layer behind feature flag
---

## What

Added an optional TurboVec-powered semantic retrieval layer to GithubArchiver. SQLite remains the source of truth; a localhost Python worker owns compressed vectors (`IdMapIndex`) and embeddings. Search modes: keyword / semantic / hybrid. SQLite migration **047** adds `semantic_index_state`. Default `SEMANTIC_SEARCH_ENABLED=0`.

## Why

Corpus FTS cannot answer meaning queries ("local voice assistant", "software that explains Windows executables"). Semantic similarity must be additive and disable-safe — not an LLM product pivot.

## Tests

- Unit: document, fingerprint, ranking, migration 047, index state
- Integration: feature-disabled path, mocked worker ranking/filter/fallback
- Full suite: 464 passed
- Worker smoke + benchmark (10k/100k) + semantic:eval fixtures

## Remaining

- Production MiniLM (`sentence-transformers`) quality vs hashing provider
- Website entity indexing (ID scheme ready; not backfilled yet)
- Admin UI surface for semantic stats (JSON already on admin status pipeline)
