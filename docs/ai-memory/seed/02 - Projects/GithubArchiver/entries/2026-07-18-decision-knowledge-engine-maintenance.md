---
schema: 1
id: decision-knowledge-engine-maintenance
date: 2026-07-18
pr: null
commit: null
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
    id: decision-knowledge-engine-philosophy
  - type: related
    id: release-knowledge-engine-on-main
  - type: related
    id: memory
related:
  - decision-knowledge-engine-philosophy
  - release-knowledge-engine-on-main
  - memory
title: Knowledge engine enters maintenance mode
migration: null
---

# Decision — Knowledge engine maintenance mode

Capability building on the knowledge engine is paused. The engine supports GithubArchiver development; it does not compete with the product for engineering time.

Operating policy:

1. Develop GithubArchiver.
2. Use `memory:query` when context is needed.
3. If retrieval is sufficient → keep shipping.
4. If retrieval misses → append durable entry → add eval → verify evals pass → continue development.

Framework-change threshold: **do not change the retrieval framework because of a single miss.** Only consider framework changes when multiple real-world misses reveal the same limitation and the existing architecture cannot express or retrieve the needed knowledge.

Success is whether the engine quietly helps build GithubArchiver faster — fewer repeated investigations, less lost context — while the corpus and eval suite grow from real work. Not new PRs against the engine itself.

Canonical note: [[Knowledge Engine Philosophy]].
