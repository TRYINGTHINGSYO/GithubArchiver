---
schema: 1
id: research-memory-center-console
date: 2026-07-18
pr: 17
commit: b2a8940
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

A chat transcript browser archives conversations. This console visualizes the **durable artifacts that survive** those conversations.

Pays off because:

- **Stable signal** — entries, decisions, incidents, and retrieval paths are long-lived; raw chats are noisy and full of dead ends
- **Model-agnostic** — Cursor, ChatGPT, Claude, or human work all surface as the same durable knowledge
- **Scalable** — only validated knowledge enters the corpus, so the UI is not overwhelmed by message volume

## Complementary views (MVP)

| View | Answers |
| --- | --- |
| Timeline | *When* something happened |
| Knowledge graph | *How* concepts relate |
| Retrieval pipeline | *Why* the engine returned what it did |
| Replay | *How* an investigation evolved |
| Corpus stats | *What* the engine knows |

## Later (evidence-driven)

See [[research-memory-center-next]] for Context Preview and dual repo/knowledge timelines. Also: richer graph motion, live eval accuracy, console patterns on enrichment pipelines.

Framework stays in maintenance mode; `/memory` is an operational interface over infrastructure.
