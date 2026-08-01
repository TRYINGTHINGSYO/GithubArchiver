# Architecture review update (current branch)

- Review date: 2026-08-01
- Reviewed branch: `cursor/architecture-review-delta-2dbd` (tracking `origin/cursor/intelligence-discovery-redesign-1514` / PR #28)
- Reviewed commit: `2b77ed95201b0c395b445bdbb475966bedcc83bc`
- Executable schema: **v44** (`CURRENT_SCHEMA_VERSION`)
- Highest migration: **044** (`migration044` / website curation)
- Application code was **not** modified in this documentation pass

## Source note

The cloud agent initially checked out `main` (`7a61a65`), which does **not** contain PR #28. Review continued only after switching to the PR #28 head so findings are not based on the stale exported workspace or on `main` alone.

The prior documentation-only snapshot lives on `main` under `docs/architecture-review/` (commit `7a61a65`, schema v13 claims). This update is a delta against that snapshot.

## Documents in this update

| Document | Purpose |
|---|---|
| [current-branch-delta.md](./current-branch-delta.md) | Status of prior high-impact findings vs this branch |
| [verification-results.md](./verification-results.md) | Exact command results from Step 3 |
| [empty-volume-cluster-defect.md](./empty-volume-cluster-defect.md) | Root-cause report for stale cluster cards after DB wipe |
| [mutation-inventory.md](./mutation-inventory.md) | Auth/CSRF/ownership inventory for all mutations |
| [pr-sequence.md](./pr-sequence.md) | Narrowly scoped next-PR sequence |
| [fix-packets/](./fix-packets/) | Implementation-ready packets for remaining work |

## Quick status

| Area | Prior review | Current branch |
|---|---|---|
| Schema | v13 | **v44** |
| Website ratings / favorites / collections / random | Absent | **Present (PR #28 + migration 044)** |
| Three-column shell | Absent | **Present** (`LeftNav` + center + `RightRail`) |
| Admin auth | Absent | **Partial** (`/admin*` gated; many mutations still open) |
| CSRF | Absent | **Still absent** (app-level) |
| `sourceAnalysis: null` | Broken | **Still broken** |
| README compare missing symbols | Broken | **Still broken** (missing imports) |
| Empty-volume cluster cards | Not diagnosed | **Confirmed** materialization stale-read; fix exists on `main` as PR #30 / `2c5b89f`, **not** on this branch |
