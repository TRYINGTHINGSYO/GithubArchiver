---
id: feature-digest-knowledge-graph
date: 2026-07-18
pr: 9
commit: 9b0d012
area:
  - memory
type: feature
status: open
confidence: confirmed
supersedes: feature-structured-timeline
related:
  - pr-7
  - pr-8
  - pr-10
  - memory
  - decision-status-hierarchy
title: Richer entry types, related graph, and Project Digest
migration: null
---

# PR #9 — Digest + knowledge graph

- Expanded types: decision, incident, migration, feature, bugfix, performance, refactor, test, release, technical-debt, research
- `related` / `id` form a tiny knowledge graph (`Knowledge Graph.md`)
- Generator builds three primary artifacts: `Timeline.md`, `Current Status.md`, `Project Digest.md`
