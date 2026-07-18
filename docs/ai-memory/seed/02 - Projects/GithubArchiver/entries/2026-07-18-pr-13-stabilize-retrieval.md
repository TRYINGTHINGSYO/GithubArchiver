---
schema: 1
id: feature-stabilize-retrieval
date: 2026-07-18
pr: 13
commit: ac157f3
area:
  - memory
type: feature
status: merged
confidence: confirmed
durability: permanent
supersedes: feature-multistage-retrieval
relationships:
  - type: supersedes
    id: feature-multistage-retrieval
  - type: validates
    id: feature-memory-retrieval
  - type: related
    id: memory
related:
  - feature-multistage-retrieval
  - memory
title: Stabilize knowledge engine with evals, explanations, and schema version
migration: null
---

# PR #13 — Stabilize the knowledge operating system

No new vault features. Focus on predictability:

1. **Explainability** — each hit lists why it was included  
2. **Eval corpus** — `docs/ai-memory/evals/` + `npm run memory:eval`  
3. **Schema version** — `schema: 1` on entries / `index.json`  
4. **Retrieval metrics** — candidates / expanded / ranked / returned / budget  

Architectural boundary: **retrieval is read-only**. Durable knowledge enters only through append-only event entries.
