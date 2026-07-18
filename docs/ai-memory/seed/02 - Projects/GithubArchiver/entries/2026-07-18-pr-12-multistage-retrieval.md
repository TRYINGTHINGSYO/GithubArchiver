---
id: feature-multistage-retrieval
date: 2026-07-18
pr: 12
commit: null
area:
  - memory
type: feature
status: open
confidence: confirmed
durability: permanent
supersedes: feature-retrieval-scoring
relationships:
  - type: supersedes
    id: feature-retrieval-scoring
  - type: references
    id: feature-memory-retrieval
  - type: related
    id: incident-search-fallback-stale
  - type: related
    id: memory
related:
  - feature-retrieval-scoring
  - feature-memory-retrieval
  - incident-search-fallback-stale
  - memory
title: Multi-stage retrieval with typed edges and token budgets
migration: null
---

# PR #12 — Multi-stage retrieval framework

Retrieval pipeline:

1. **Candidate retrieval** — top K by concept match  
2. **Typed graph expansion** — follow `caused-by` / `implemented-by` / `references` / …  
3. **Re-rank** — full score model  
4. **Assemble** — stop at `--budget` tokens  

Adds explicit `durability` (`transient` | `temporary` | `release` | `permanent`) and typed `relationships` while keeping legacy `related:` compatible.
