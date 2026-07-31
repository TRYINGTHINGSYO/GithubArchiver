# Durable homepage discovery materialization

## Problem

Homepage discovery sections already had a materializer and live-query fallback, but publish was per-table (readers could observe empty mid-refresh), overlapping triggers could race, run metadata was thin, and `get_project_state` could only say whether `discovery_system_status` existed. Local schema drift (`schema_version` 26 without migration026 tables) also made materialization appear absent.

## Decision

Harden the existing discovery materialization pipeline rather than replacing it:

1. **Atomic publish** — compute all sections, then replace every discovery payload table plus status timestamps in one SQLite transaction. Failed refresh rolls back and preserves last-known-good payloads; live fallback remains intact when no published data exists.
2. **Durable runs** — `discovery_materialization_runs` records run id, status, start/end, source commit, algorithm version, per-section row counts, and publish flag.
3. **Cross-process dedupe** — exclusive lease via `BEGIN IMMEDIATE` so enrich side-effects, in-process cadence, CLI, and admin triggers cannot publish concurrently.
4. **Explicit staleness** — `DISCOVERY_MATERIALIZATION_STALE_MS` (default 2h). MCP reports `available`, `stale`, `age_ms`, latest/published runs.
5. **Triggers** — in-process daemon cadence for `discovery`, admin `discovery-materialize`, CLI `npm run discovery:materialize`.
6. **Schema integrity** — `repairSchemaDrift` re-applies migration026 DDL when version ≥ 26 but discovery/scheduled tables are missing; do not invent alternate tables ad hoc.

Out of scope for this decision: materializing readiness or high-signal homepage sections.

## Why

This keeps the proven read path and live fallback while closing the durability gaps that cause blank pages, duplicate work, and opaque MCP state.

## Alternatives Rejected

- Rebuilding a parallel homepage cache with new tables/read APIs.
- In-process-only mutex (fails across CLI/admin/enrich processes).
- Silently creating discovery tables outside `repairSchemaDrift` / migrations.

## Affected Systems

- `src/lib/server/discovery-materialized.ts`
- `src/lib/server/discovery-materialization.ts`
- `src/lib/server/workers/discovery.ts`
- `src/lib/server/daemon-cadence.ts` / background daemon
- Admin workers API + status controls
- `packages/githubarchive-mcp` project state
- Schema migrations 026 repair + 039

## Commit

6b826fa

## Date

2026-07-31

## Follow-up Work

- Homepage UI materialization age / stale warnings.
- Optional readiness count materialization (separate slice).
