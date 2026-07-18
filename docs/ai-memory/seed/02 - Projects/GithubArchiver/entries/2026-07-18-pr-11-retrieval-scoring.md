---
id: feature-retrieval-scoring
date: 2026-07-18
pr: 11
commit: 5972b3c
area:
  - memory
type: feature
status: merged
confidence: confirmed
supersedes: feature-memory-retrieval
related:
  - feature-memory-retrieval
  - incident-search-fallback-stale
  - incident-gharchive-createevent
  - decision-status-hierarchy
  - search-fallback
  - memory
title: Ranked retrieval scoring model for memory query
migration: null
---

# PR #11 — Retrieval scoring model

`memory:query` now ranks graph hits instead of returning an unordered connected component:

```
score = concept + edge + confidence + recency + durability + status
```

Default filter is **confirmed only**. Use `--include-hypotheses` for investigations. Output is clustered by type (Decision / Incident / Migration / Debt / …) with a scoreboard so agents can stop after the top few items.
