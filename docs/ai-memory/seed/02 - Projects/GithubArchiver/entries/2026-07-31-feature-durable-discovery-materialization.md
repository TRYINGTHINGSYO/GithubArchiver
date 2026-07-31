---
schema: 1
id: feature-durable-discovery-materialization
date: 2026-07-31
pr: null
commit: null
area:
  - homepage
  - discovery
  - mcp
type: feature
status: closed
confidence: confirmed
durability: permanent
relationships:
  - type: caused-by
    id: incident-schema26-discovery-tables-missing
  - type: related
    id: research-homepage-readiness-cache
  - type: references
    id: decision-mcp-first-dev-workflow
title: Harden homepage discovery materialization durability
---

## What

Hardened the existing homepage discovery materialization pipeline (no rewrite of
the live-fallback read path):

- migration039 `discovery_materialization_runs` (run metadata + lease)
- atomic multi-table publish transaction (failed refresh preserves last good)
- cross-process exclusive lease / dedupe
- in-process daemon cadence for `discovery`
- admin `discovery-materialize` + CLI `npm run discovery:materialize`
- MCP `get_project_state` freshness (`available`, `stale`, `age_ms`, runs, row counts)
- explicit staleness window via `DISCOVERY_MATERIALIZATION_STALE_MS` (default 2h)
- `repairSchemaDrift` re-applies migration026 when version≥26 but tables missing

Out of scope: readiness / high-signal materialization.

## Tests

- `tests/discovery-materialization-durable.test.ts`
- `tests/discovery-pipeline.test.ts`
- `packages/githubarchive-mcp/tests/mcp-tools.test.ts`

## Remaining

Expose materialization age in the homepage UI (registry follow-up).
