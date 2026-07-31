# Homepage readiness and high-signal materialization

## Problem

Homepage readiness aggregates (`getDataReadiness`) were the dominant cold-path cost (~6.4s per 30s TTL expiry). High-signal cards were also live. Discovery materialization was already durable and isolated; folding readiness into that publish cycle would couple failure modes and leases.

## Decision

Add an **independent** readiness + high-signal materialization slice:

1. Separate run table + singleton snapshot (`homepage_readiness_runs` / `homepage_readiness_snapshot`).
2. Same-cycle readiness compute + high-signal rows/count; one atomic publish.
3. Failed refresh preserves last-known-good snapshot; live fallback when missing/stale/watermark-mismatched.
4. Explicit staleness (`HOMEPAGE_READINESS_STALE_MS`, default 15m) plus source watermarks (`MAX(enriched_at)`, `MAX(classified_at)`, `COUNT(*)`).
5. Optimize `computeDataReadiness` in place (batched aggregates; reuse `discovery_system_status` corpus counters when semantics match).
6. MCP reports `materializations.homepage_discovery` and `materializations.homepage_readiness` separately.
7. In-process cadence, admin trigger, and `npm run readiness:materialize`.

Do **not** reuse `discovery_materialization_runs` or the discovery lease. Archive Pulse stays out of scope.

## Why

Keeps discovery durability intact while removing the largest measured homepage latency source, with clear failure isolation and MCP observability.

## Alternatives Rejected

- Extending discovery materialization to include readiness (coupled leases/publish).
- Dual calculation paths for readiness (drift risk) — optimize the existing compute instead.
- Event-driven invalidation on every enrich write for v1 (age + watermarks suffice).

## Affected Systems

- `src/lib/server/data-readiness.ts`
- `src/lib/server/homepage-readiness-*.ts`
- Homepage load (`+page.server.ts`)
- Daemon cadence / admin workers / CLI
- GithubArchive+ MCP project state

## Commit

28ecfa3

## Date

2026-07-31

## Follow-up Work

- Homepage UI age / watermark mismatch signals.
- Optional Archive Pulse materialization as a later slice.
