---
schema: 1
id: research-memory-center-console
date: 2026-07-18
pr: null
commit: null
area:
  - memory
  - product
type: research
status: open
confidence: confirmed
durability: temporary
supersedes: null
relationships:
  - type: references
    id: decision-knowledge-engine-philosophy
  - type: related
    id: feature-stabilize-retrieval
  - type: related
    id: memory
related:
  - decision-knowledge-engine-philosophy
  - feature-stabilize-retrieval
  - memory
title: Memory Center as intelligence console (not chat history)
migration: null
---

# Research — AI Memory Center product surface

Product vision: expose the knowledge engine as an **intelligence console** inside GithubArchiver (`/memory`), not as a chat transcript browser.

## Why not chat history

Durable knowledge is append-only entries. Conversation transcripts are intentionally not stored. The console visualizes corpus timeline, typed graph, live `memory:query` retrieval, and investigation paths over relationships — not Cursor/ChatGPT message dumps.

## MVP shipped with this work

- Sidebar/nav **Memory** → `/memory`
- **Timeline** of durable entries
- **Knowledge graph** (typed edges, click-to-dossier)
- **Live retrieval** panel (candidate → expand → re-rank → budget) via `/api/memory/query`
- **Investigation path / replay** over related entries
- Corpus stats (entries, decisions, incidents, edges)

## Later (evidence-driven)

- Richer force simulation / thinking-map animations
- Eval accuracy metrics live on the dashboard
- Same console patterns applied to repository investigations and enrichment pipelines

Framework stays in maintenance mode; this is a **product UI** over the stable engine.
