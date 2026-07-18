---
schema: 1
id: research-memory-center-next
date: 2026-07-18
pr: 17
commit: null
area:
  - memory
  - product
  - ui
type: research
status: open
confidence: confirmed
durability: temporary
supersedes: null
relationships:
  - type: references
    id: research-memory-center-console
  - type: references
    id: feature-memory-center-console
  - type: related
    id: decision-knowledge-engine-philosophy
related:
  - research-memory-center-console
  - feature-memory-center-console
  - decision-knowledge-engine-philosophy
title: Deferred Memory Center UX — Context Preview and dual timelines
migration: null
---

# Research — Next Memory Center product ideas (deferred)

Not engine work. Product UX over the stable corpus. Ship only when real use shows the MVP needs them.

## Context Preview (ops pane, not chat)

When a query runs (`memory:query` / `/api/memory/query`), show a **Context Package** pane: the exact ranked entries an agent would receive, token budget used, confidence filter, and a short reasoning path. Complements the live pipeline bars without exposing conversation history.

## Dual histories on repository investigations

Side-by-side:

- **Repository Timeline** — creation, enrichment, archival, deletion, recovery
- **Knowledge Timeline** — incidents, decisions, migrations, fixes about the system

Two histories (what happened to the repo vs what happened to our understanding). Distinctive GithubArchiver identity if it earns its place after the MVP is used.
