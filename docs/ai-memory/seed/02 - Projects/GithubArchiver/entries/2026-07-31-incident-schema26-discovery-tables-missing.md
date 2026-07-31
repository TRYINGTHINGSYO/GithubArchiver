---
schema: 1
id: incident-schema26-discovery-tables-missing
date: 2026-07-31
pr: null
commit: null
area:
  - db
  - homepage
  - discovery
type: incident
status: closed
confidence: confirmed
durability: permanent
relationships:
  - type: related
    id: research-homepage-readiness-cache
  - type: related
    id: feature-mcp-resources-prompts-review
title: schema_version 26 recorded without discovery materialization tables
---

## What

Local `data/githubarchive.db` reported `MAX(schema_version) = 26` with
`applied_at = 2026-07-24T05:40:47.909Z` for version 26, but none of the
migration026 objects existed:

- `scheduled_jobs`
- `discovery_projects_to_watch`
- `discovery_emerging_topics`
- `discovery_fastest_clusters`
- `discovery_deleted_preserved`
- `discovery_unusual_finds`
- `discovery_system_status`

Versions 1–26 were contiguous (no gaps). Migrations 27–38 had never been
applied. MCP therefore reported homepage materialization unavailable.

## Why (diagnosis)

`runMigrationsThrough` records `schema_version` only after `migration026()`
returns. `migration026` has been `CREATE TABLE IF NOT EXISTS …` since commit
`2330421` (2026-07-17). There is no in-repo `DROP TABLE` for these objects.

So this is not “version recorded before DDL.” It is post-success object loss
or a transplanted/incomplete snapshot that kept `schema_version` while losing
tables — the same drift class already handled by `repairSchemaDrift` for
migrations 014/015.

The MCP path opens SQLite readonly and never migrates, which is why the local
DB stayed at v26 until an app `getDb()` open ran migrations + repair.

## Fix

Extended `repairSchemaDrift` to re-apply idempotent `migration026` DDL when
`schema_version >= 26` and discovery/scheduled tables are absent. Added
migration039 for durable materialization run metadata. Opening the DB via
`getDb()` repaired tables and advanced schema to 39.

## Tests

- `tests/discovery-materialization-durable.test.ts` drift repair case
- Existing discovery pipeline + MCP tool tests

## Remaining

None for this integrity incident. Do not invent alternate homepage tables ad
hoc — repair known migration objects.
