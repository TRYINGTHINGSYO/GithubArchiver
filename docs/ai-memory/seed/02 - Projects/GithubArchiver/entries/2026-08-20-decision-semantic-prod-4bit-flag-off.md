---
id: decision-semantic-prod-4bit-flag-off
date: 2026-08-20
pr: 33
commit: pending
area:
  - search
type: decision
status: open
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: related
    id: validation-semantic-prod-snapshot-gate-result
  - type: implemented-by
    id: pr-33
title: Production MiniLM uses SEMANTIC_VECTOR_BITS=4; flag stays OFF at merge
---

## Decision

After the READ-ONLY production-snapshot gate:

- **Recommended production MiniLM bit width: 4** (`SEMANTIC_VECTOR_BITS=4` set explicitly on Railway).
- App/worker **code fallback remains 2** for hashing CI compatibility.
- **`SEMANTIC_SEARCH_ENABLED=0`** at merge — do not enable behind the flag until human review of the 80-query pack and enrichment coverage improves.

## Coverage fact

Production SQLite: **816,347** repos. Semantic-eligible / indexed subset: **46,360** (~5.7%). Do not claim whole-archive semantic coverage.
