---
schema: 1
id: feature-homepage-readiness-materialization
date: 2026-07-31
pr: null
commit: null
area:
  - homepage
  - readiness
  - mcp
type: feature
status: closed
confidence: confirmed
durability: permanent
relationships:
  - type: related
    id: feature-durable-discovery-materialization
  - type: related
    id: research-homepage-readiness-cache
  - type: references
    id: decision-mcp-first-dev-workflow
title: Materialize homepage readiness and high-signal snapshot
---

## What

Independent homepage readiness + high-signal materialization (not coupled to
discovery):

- migration040 `homepage_readiness_runs` + singleton `homepage_readiness_snapshot`
- batched `computeDataReadiness` aggregates; corpus counts from
  `discovery_system_status` when semantics match
- same-cycle high-signal rows + count; atomic publish; failed refresh preserves
  last-known-good snapshot
- explicit staleness + source watermarks (enriched/classified/repo count)
- in-process cadence, admin/CLI triggers
- MCP `materializations.homepage_discovery` / `homepage_readiness`

Live fallback retained. Archive Pulse out of scope.

## Tests

- `tests/homepage-readiness-materialization.test.ts`
- MCP project-state shape update
