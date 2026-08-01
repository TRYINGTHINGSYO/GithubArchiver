# Defect report: cluster cards after empty / wiped database volume

- Status: **confirmed on PR #28 branch** (`2b77ed9`)
- Fix already on `main`: commit `2c5b89f` / PR #30 (`cursor/cluster-wipe-empty-state-1514`) — **not merged into this branch**
- Severity: **P1** (incorrect “live intelligence” after wipe)

## Symptom

After the database volume is deleted (or memberships are wiped), predefined / previously measured cluster cards — especially “fastest-growing” — can still appear on homepage / discover surfaces.

## Root cause

**Primary:** discovery landing prefers durable SQLite materialization and does not verify that live cluster memberships still exist.

1. `getDiscoveryLanding` (`src/lib/server/discovery.ts`) returns `getMaterializedDiscoveryLanding(...)` whenever materialization status has `last_discovery_analysis_at`.
2. `getMaterializedDiscoveryLanding` (`src/lib/server/discovery-materialized.ts`) reads frozen JSON from `discovery_fastest_clusters` / `discovery_projects_to_watch` with **no membership-count gate**.
3. Homepage (`src/routes/+page.server.ts`) treats non-empty `discovery.fastestGrowing` as growth mode and renders those cards as measured intelligence.

Wiping operational repo/membership data (or recreating a volume while an older DB/materialization remains reachable) therefore preserves **last-known-good growth payloads**.

**Secondary:** process TTL cache `cached('cluster-analytics', 30_000, …)` in discovery analytics. On this branch, `clearTtlCache` is test-only; DB close/reopen does not clear it.

**Contributing (not the displayed growth cards):** `ensureClusterRegistry()` / migration seeding inserts `CLUSTER_DEFINITIONS` into `repo_clusters` with `repo_count = 0`. That is a static taxonomy seed, not measured growth — but it makes empty DBs look “pre-populated.”

## What the cards are

| Hypothesis | Verdict |
|---|---|
| Real live cluster instances after wipe | **No** |
| Static cluster definitions rendered as growth cards | **No** (registry is seed/taxonomy; browse filters typically require activity) |
| **Stale serialized statistics** in materialization tables | **Yes — primary** |
| Process TTL stale analytics | **Yes — secondary / short window** |
| Client localStorage / IndexedDB | **No** (only UI rail collapse prefs) |
| Placeholder / fake demo arrays | **No** on this branch (`ALLOW_DEV_CLUSTER_PLACEHOLDERS` introduced in `2c5b89f` only) |
| Seeded membership records with fake counts | **No** (`repo_count` starts at 0) |

## Affected files

| File | Role |
|---|---|
| `src/lib/server/discovery-materialized.ts` | Serves stale `discovery_fastest_clusters` payloads |
| `src/lib/server/discovery.ts` | Prefers materialization; TTL analytics cache |
| `src/lib/server/db/clusters.ts` | Analytics + registry seed |
| `src/lib/server/ttl-cache.ts` | No production clear-on-reopen on this branch |
| `src/lib/server/db/connection.ts` | Reopen path does not invalidate TTL |
| `src/lib/server/cluster-registry.ts` | Static `CLUSTER_DEFINITIONS` |
| `src/lib/server/db/schema.ts` | Seeds clusters; materialization tables |
| `src/routes/+page.server.ts` / `+page.svelte` | Homepage growth cards |
| `src/routes/discover/+page.server.ts` / `+page.svelte` | Discover landing |
| `src/lib/server/homepage-readiness-materialized.ts` | Parallel stale high-signal risk |

## Data-source correction

Live growth must be computed only from the **active** database:

- Memberships: `repository_cluster_memberships`
- Repo timing: `repos.first_seen_at` (and related filters)
- Cluster metadata: `repo_clusters` (for labels/slugs), never as proof of growth alone
- Growth math: `computeGrowthPercent` with existing guardrails (`MIN_CLUSTER_CURRENT_COUNT = 20`, `MIN_CLUSTER_PREVIOUS_COUNT = 5`)

Materialized payloads are a **cache**, not a source of truth. If live membership count is 0, materialized growth sections must be empty (and preferably purged).

## Proposed behavior

| Condition | UI |
|---|---|
| `COUNT(repos) = 0` | Fresh-install empty state (no growth cards, no “fastest-growing”) |
| Repos exist, `COUNT(repository_cluster_memberships) = 0` | “No clusters generated yet.” |
| Memberships exist but growth guardrails fail | Empty growth section with honest reason (not fake cards) |
| Static taxonomy needed | Separate “Browse cluster types” view only — not measured live intelligence |

Rules:

- Do not display fastest-growing clusters with zero real assignments.
- Counts and growth must come from the active DB on read, or from materialization that has been validated against live memberships.
- Deleting/recreating the volume must not preserve old operational statistics.

## Cache invalidation requirements

1. If live memberships = 0, refuse empty discovery cluster sections and **purge** `discovery_fastest_clusters` / `discovery_projects_to_watch` (and related stale readiness payloads as applicable).
2. Clear process TTL analytics on DB release/open and after successful materialize publish.
3. Never prefer materialization over an explicit empty-membership signal.

## Tests needed

On this branch: **missing**.

Already implemented on `main` in `2c5b89f` (backport target):

- `tests/cluster-wipe-empty-state.test.ts` — fresh DB, repos-without-memberships, stale materialization wipe, TTL on reopen

Minimum acceptance tests for a fix PR:

1. Fresh schema → homepage/discover growth arrays empty; empty-state reason `no-repositories` or equivalent.
2. Repos without memberships → no growth cards; reason `clustering-incomplete`.
3. Insert stale `discovery_fastest_clusters` rows while memberships = 0 → readers return empty and purge rows.
4. TTL analytics does not survive DB reopen with empty memberships.

## Recommended remediation path

Cherry-pick / merge `2c5b89f` (PR #30) onto the release line that includes PR #28, or re-apply the same membership gates + purge + TTL clear + empty-state UI. Do not invent a second mechanism.
