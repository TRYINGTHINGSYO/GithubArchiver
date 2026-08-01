# Fix packet 05 — Recurring source snapshot refresh

## Problem

Automated archive selection only considers repositories with **no** source snapshot. After the first capture, head changes are never re-archived by the daemon; only manual/export paths can capture later states.

## Evidence

- `listEnrichedReposForArchive` — `src/lib/server/db/repos.ts` — `NOT EXISTS (... snapshot_type = 'source')`
- `countUnarchivedSourceSnapshots` — `src/lib/server/daemon-backlog.ts` — same predicate
- `tests/archive-queue.test.ts` — “selects only enriched repos missing a source snapshot”
- Archiver already records `head_sha` on source snapshots — `src/lib/server/archiver.ts`

## Affected files

- `src/lib/server/db/repos.ts` (`listEnrichedReposForArchive` and helpers)
- `src/lib/server/daemon-backlog.ts`
- `src/lib/server/workers/archive.ts`
- `src/lib/server/archiver.ts` (skip-if-same-head logic)
- `tests/archive-queue.test.ts` (+ new refresh cases)
- Config/env docs for cadence limits

## User impact

Preservation promise fails silently: repositories appear “archived” forever while GitHub HEAD drifts; historical source states are missing.

## Severity

**P1**

## Exact desired behavior

1. Queue includes:
   - enriched repos with zero source snapshots (existing), and
   - enriched repos whose latest source `head_sha` differs from current remote default-branch HEAD (or whose last source archive is older than a configured refresh interval **and** head differs).
2. If remote HEAD equals latest stored `head_sha`, skip without writing a duplicate snapshot.
3. Rate limits / `ARCHIVE_MAX_REPOS` still apply; refresh shares budget with first-time captures (prefer first-time when pressure is high, or configurable split).
4. Permanent `archive_failed` events still exclude repos.

## Implementation constraints

- Do not re-download every repo every cycle
- Compare HEAD before full tarball download when possible
- Respect metadata-only mode and storage pressure limits
- Avoid unbounded historical retention — rely on existing retention/cleanup policies (do not invent a second retention system here)

## Schema changes

Likely none. May add index supporting “latest source head_sha per repo” if query plans require it.

## API changes

None required. Manual `actions?archive` remains force path.

## UI changes

Optional later: show “last source capture / head” on detail — out of scope unless trivial.

## Migration and rollback

- Logic-only change preferred
- Rollback restores one-shot queue predicate

## Tests

- Repo with source at head A, remote now B → selected for refresh
- Repo with source at head A, remote still A → not selected (or selected then skipped as unchanged)
- Repo with no source → still selected
- Permanent archive_failed → excluded
- Budget/priority: first-time missing source preferred under tight `ARCHIVE_MAX_REPOS` (define and test)

## Explicit out-of-scope

- ZIP-only strategy redesign
- Full object storage migration
- Worker process isolation (packet 06)

## Acceptance criteria

- [ ] Daemon archive cycle can capture a second source snapshot when HEAD changes
- [ ] Unchanged HEAD does not create duplicate source rows
- [ ] Tests cover refresh + skip + first-time paths
- [ ] Storage pressure / metadata-only behavior unchanged
