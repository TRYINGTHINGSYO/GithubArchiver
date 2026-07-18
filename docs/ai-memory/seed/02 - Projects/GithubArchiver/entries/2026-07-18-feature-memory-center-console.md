---
schema: 1
id: feature-memory-center-console
date: 2026-07-18
pr: null
commit: b2a8940
area:
  - memory
  - product
  - ui
type: feature
status: open
confidence: confirmed
durability: release
supersedes: null
relationships:
  - type: references
    id: research-memory-center-console
  - type: references
    id: decision-knowledge-engine-philosophy
  - type: related
    id: feature-stabilize-retrieval
related:
  - research-memory-center-console
  - decision-knowledge-engine-philosophy
  - feature-stabilize-retrieval
title: Ship Memory Center console at /memory
migration: null
---

# Feature — Memory Center console

Adds a first-class **Memory** product surface to GithubArchiver:

- Nav link → `/memory`
- Timeline, knowledge graph, and live retrieval views
- Entry dossier with markdown body + typed relationships
- Investigation path / replay over the related component
- `/api/memory/query` for the animated retrieval panel

Retrieval library moved to `src/lib/server/ai-memory.ts` so the app and CLI share one engine. Read-only; no chat transcripts.
