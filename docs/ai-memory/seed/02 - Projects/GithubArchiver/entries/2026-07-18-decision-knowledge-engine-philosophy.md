---
schema: 1
id: decision-knowledge-engine-philosophy
date: 2026-07-18
pr: null
commit: 055adee
area:
  - memory
  - adoption
type: decision
status: verified
confidence: confirmed
durability: permanent
supersedes: null
relationships:
  - type: references
    id: release-knowledge-engine-on-main
  - type: related
    id: feature-stabilize-retrieval
  - type: related
    id: memory
related:
  - release-knowledge-engine-on-main
  - feature-stabilize-retrieval
  - memory
title: Knowledge engine improves knowledge before framework
migration: null
---

# Decision — Knowledge before framework

Locked operating principle after PRs #6–#14 landed the knowledge engine on `main`.

When retrieval fails: append durable knowledge + eval, regenerate, continue shipping. Do **not** add retrieval capabilities until repeated real-world failures show the architecture cannot express or retrieve the required knowledge.

Success metrics: retrieval precision, eval stability, time to context, knowledge capture rate — not corpus size.

Canonical note: [[Knowledge Engine Philosophy]].
