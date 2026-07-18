---
id: feature-memory-retrieval
date: 2026-07-18
pr: 10
commit: 6f5784c
area:
  - memory
type: feature
status: merged
confidence: confirmed
supersedes: feature-digest-knowledge-graph
related:
  - feature-digest-knowledge-graph
  - feature-structured-timeline
  - feature-retrieval-scoring
  - incident-search-fallback-stale
  - incident-gharchive-createevent
  - migration-030
  - search-fallback
  - memory
title: Memory retrieval layer with index.json and graph query
migration: null
---

# PR #10 — Retrieval over the knowledge architecture

Adds machine-readable `index.json`, required stable `id`s, `confidence` (`confirmed` | `hypothesis` | `deprecated`), and:

```bash
npm run memory:query -- "search fallback"
```

Agents traverse metadata + `related` edges to assemble minimal task context instead of grepping prose.
