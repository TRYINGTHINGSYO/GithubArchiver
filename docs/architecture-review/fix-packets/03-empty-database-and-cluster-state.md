# Fix packet 03 — Empty database and cluster state

## Problem

After a database volume wipe, “fastest-growing” / growth cluster cards can still appear from stale discovery materialization (and short-lived TTL cache), presenting non-existent intelligence as live.

## Evidence

- Full report: `docs/architecture-review/empty-volume-cluster-defect.md`
- `getDiscoveryLanding` prefers materialization without membership gate — `src/lib/server/discovery.ts`
- `getMaterializedDiscoveryLanding` reads `discovery_fastest_clusters` — `src/lib/server/discovery-materialized.ts`
- Fix already on `main`: `2c5b89f` (PR #30) — **not** on PR #28 head

## Affected files

Expected (from `2c5b89f` / equivalent):

- `src/lib/server/discovery-materialized.ts`
- `src/lib/server/discovery.ts`
- `src/lib/server/db/clusters.ts` / connection + TTL clear helpers
- `src/lib/server/ttl-cache.ts`
- `src/routes/+page.server.ts` / `+page.svelte`
- `src/routes/discover/+page.*`
- `src/lib/server/homepage-readiness-materialized.ts`
- `tests/cluster-wipe-empty-state.test.ts` (add)

## User impact

Operators see fake “fastest-growing” clusters after wipe/reinstall → false confidence, broken empty-state onboarding, distrust of intelligence surfaces.

## Severity

**P1**

## Exact desired behavior

| Condition | UI |
|---|---|
| Zero repositories | Fresh-install empty state |
| Repos exist, zero memberships | “No clusters generated yet.” |
| Growth guardrails fail | Honest empty growth section |
| Taxonomy browsing | Separate “Browse cluster types” only |

Never show measured growth cards without live assignments. Counts/growth from active DB only. Volume recreate must not preserve old operational statistics.

## Implementation constraints

- Prefer cherry-pick/backport of `2c5b89f` over a second design
- Materialization remains a cache, not source of truth
- Do not remove static `CLUSTER_DEFINITIONS` registry; stop presenting it as live metrics

## Schema changes

None required (purge existing materialization rows at runtime).

## API changes

Discovery APIs return empty cluster growth arrays when memberships = 0; may include `emptyReason`.

## UI changes

Homepage/discover empty states with the two distinct messages above.

## Migration and rollback

- No migration
- Rollback: revert cherry-pick; worst case returns to stale cards (current behavior)

## Tests

Port/adapt `tests/cluster-wipe-empty-state.test.ts`:

1. Fresh DB → no growth cards
2. Repos without memberships → clustering-incomplete empty state
3. Stale materialization + zero memberships → purge + empty response
4. TTL does not survive reopen with empty memberships

## Explicit out-of-scope

- Redesigning cluster taxonomy
- Semantic clustering / embeddings
- Auth (packet 01)

## Acceptance criteria

- [ ] Zero-repo and zero-membership states never render growth cards
- [ ] Stale `discovery_fastest_clusters` cannot surface after wipe
- [ ] Tests from PR #30 (or equivalent) pass on this line
- [ ] Static taxonomy not shown as measured live intelligence
