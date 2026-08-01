# Fix packet 07 — SQLite contention and query bounds

## Problem

Synchronous `better-sqlite3` remains the system of record. Expensive unbounded operator queries, maintenance scans, and large reads still block writers/readers on the shared DB file even with a separate daemon process.

## Evidence

- Engine unchanged: better-sqlite3 + WAL
- Maintenance doctor/storage paths perform broad scans — `src/lib/server/doctor.ts`, `storage.ts`
- Discovery/search paths can be heavy under large catalogs
- Process split (packet 06) reduces event-loop coupling but not SQLite write lock contention

## Affected files

- Hot query modules under `src/lib/server/db/*`, `discovery.ts`, `search` routes
- `src/lib/server/storage.ts`, `doctor.ts`, `retention.ts`
- Indexes in `src/lib/server/db/schema.ts` (additive migrations)
- Tests for query limits

## User impact

Admin actions and peak daemon load cause site-wide latency spikes / timeouts.

## Severity

**P2**

## Exact desired behavior

1. All list/export/maintenance preview endpoints have hard `LIMIT`s / pagination.
2. Expensive maintenance defaults to preview/dry-run and processes deletes in bounded batches.
3. Missing indexes for proven slow predicates are added via migration after EXPLAIN evidence.
4. Large file downloads stream; avoid buffering whole archives when already streamable.

## Implementation constraints

- Stay on SQLite for this packet
- No premature Postgres migration
- Measure with existing datasets/tests before adding indexes
- Do not combine with auth or UI redesign

## Schema changes

Additive indexes only, versioned (`CURRENT_SCHEMA_VERSION` bump).

## API changes

Enforce max limits on query params; return 400 when exceeded.

## UI changes

Admin UIs show batch progress; no unbounded “delete all” without batching.

## Migration and rollback

- Index-only migrations are forward-safe
- Rollback drops indexes if needed (usually leave them)

## Tests

- API rejects absurdly large limits
- Batch cleanup processes N rows per call
- Migration test for new indexes

## Explicit out-of-scope

- Moving to Postgres/Turso
- Full search engine replacement (packet 10)
- Auth

## Acceptance criteria

- [ ] Documented max limits for top expensive endpoints
- [ ] Maintenance deletes are batched
- [ ] New indexes covered by migration tests
- [ ] No unbounded `SELECT *` admin previews without cap
