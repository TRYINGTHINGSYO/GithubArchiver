# GithubArchive+ Roadmap

**North star:** a repository intelligence and preservation platform built on append-only history — not a GitHub mirror. GithubArchive+ should feel like a software museum: it remembers projects, explains why they matter, and shows how recoverable they are if GitHub disappears.

**Design rules:**

1. **Append-only everywhere** — history tables never update prior rows; latest row = current state.
2. **One source of truth** — derived intelligence must be reproducible from historical data, not a competing store.
3. **Compounding value** — each version answers a deeper question using what prior versions already preserved.
4. **Layers, not monoliths** — raw facts → derived facts → repository understanding → ecosystem intelligence → state reconstruction.
5. **Explain significance** — raw events say what happened; intelligence reports explain why the change matters.

**Progression:**

```
Collect → Preserve → Derive → Reconstruct → Understand → Analyze
```

| Stage | Question |
|-------|----------|
| Collect | What repos exist? |
| Preserve | What changed, and when? |
| Derive | What's growing / trending / notable? |
| Reconstruct | What did this repo look like on date X? |
| Understand | What is this, why preserve it, and what evidence do we have? |
| Analyze | How does the ecosystem evolve? |

Every repository page should answer five product questions:

1. What is this?
2. Why does it matter?
3. What changed?
4. What evidence do we have?
5. Could this still exist if GitHub vanished?

**Shipped (pre-v10):** schema v9, GH Archive + sharded Search ingest, enrichment, README/tarball snapshots, `repo_metrics_snapshots`, `repository_events`, FTS, `/admin` + job history, Railway auto-scan.

**Existing hooks:** `enrich.ts` diffs license/topics on refresh; `appendRepoEvent`; archive worker downloads full tarballs; WAL enabled.

---

## v10 — Historical Resolution (Phase 1A)

**Single cohesive migration** — all three tables answer: *"What changed, and when?"*

### Schema (append-only)

#### `repo_commit_snapshots`

| Column | Notes |
|--------|-------|
| `id` | PK |
| `repo_id` | FK |
| `sha` | Default-branch HEAD |
| `tree_sha` | Tree at commit |
| `parent_sha` | Optional |
| `committed_at` | Author date from commit |
| `author_name`, `author_email` | Optional |
| `default_branch` | Branch name at observation |
| `observed_at` | When we recorded this (ISO) |

Insert **only when SHA changes** (or first observation).

#### `repo_license_history`

| Column | Notes |
|--------|-------|
| `id` | PK |
| `repo_id` | FK |
| `license` | SPDX or name string |
| `observed_at` | When detected |

Insert **only when license changes**.

#### `repo_topics_history`

| Column | Notes |
|--------|-------|
| `id` | PK |
| `repo_id` | FK |
| `topics_json` | Full topics array at observation |
| `added_json` | Topics added since prior row (optional) |
| `removed_json` | Topics removed since prior row (optional) |
| `observed_at` | When detected |

Insert **only when topics change**.

### Pipeline (enrich / refresh)

1. Fetch default branch HEAD SHA if not already in metadata response (lightweight commits API).
2. Compare SHA, license, topics vs latest history row (or current `repos` row on first enrich).
3. On change → append history row + canonical `repository_events`:

| Event type | Payload |
|------------|---------|
| `default_branch_updated` | `{ sha, tree_sha, committed_at, default_branch }` |
| `license_changed` | `{ old, new }` |
| `topics_changed` | `{ added, removed, topics }` |

Renames / deletes / archives continue through existing flows.

### Enables

- *"When did this switch to Apache?"*
- *"When did it adopt AI topics?"*
- *"What was the HEAD on July 5?"*
- Foundation for **repository state** reconstruction (below)

---

## v11 — Derived Intelligence (Phase 1B)

**Read-only layer** — no schema changes if performance allows. **Canonical metric definitions:** [`docs/METRICS.md`](./METRICS.md).

### Phase 1 — SQL-derived metrics

From `repo_metrics_snapshots` only (no new GitHub API calls):

| Metric | Definition (summary) |
|--------|----------------------|
| `star_velocity_24h` | Δstars ÷ elapsed days (24h lookback) |
| `star_velocity_7d` | Δstars ÷ elapsed days (7d lookback) |
| `fork_velocity_7d` | Δforks ÷ elapsed days |
| `watcher_velocity_7d` | Δwatchers ÷ elapsed days |
| `star_acceleration` | current 7d star velocity − prior 7d star velocity |
| `growth_percentile` | rank of `star_velocity_7d` within language/discovery-week cohort |

Prefer SQL views/CTEs; optional in-process cache or materialized `repo_growth_daily` only if profiling requires it (must remain rebuildable from snapshots).

### Phase 2 — API

| Endpoint | Feed |
|----------|------|
| `GET /api/trending/velocity` | Fastest growing (24h / 7d) |
| `GET /api/trending/gainers` | Biggest weekly star gain (absolute Δ) |
| `GET /api/trending/acceleration` | Highest acceleration |
| `GET /api/trending/emerging` | High acceleration, low star count |

Shared filters: `language`, `created_after`, `min_stars`, `min_growth`, `limit`.

Refactor `getTrendSnapshot()` to use shared metric helpers (replaces ad-hoc `MAX − MIN`).

### Phase 3 — UI

- 🚀 Fastest Growing
- ⭐ Biggest Weekly Gainers
- 📈 Highest Acceleration
- 🌱 Emerging Projects
- 😴 Sleeping Giants (stretch)

Trending dashboard and/or birth-feed sections; extend repo cards with `star_velocity_7d` when defined.

---

## v11-ops — Autonomous daemon & repo intelligence

**Parallel track** — [`PROPOSAL-autonomous-intelligence.md`](./PROPOSAL-autonomous-intelligence.md). Uses **`migration011`** (not the v11 views-only metrics track).

- Backlog-aware daemon planner (`daemon-planner.ts`)
- `job_runs.reason` + `daemon_decisions` log
- On-demand snapshot export + `archive_snapshots.capture_reason`
- `repos.summary` / `repos.category` at enrich time
- Gap-aware GitHub Search via `repo_category_daily`

Implementation order is section 9 of the proposal.

---

## v11.5 — Discovery UI Refresh

**After v11 metrics ship** — homepage and feeds need real velocity/acceleration data before the redesign pays off.

Planned hierarchy changes (spec in [`docs/UI.md`](./UI.md)):

- Hero + stat cards answering “what’s archived / what’s new / are we live?”
- Sidebar navigation; quick filters vs collapsed advanced filters
- Event stream icons + color categories (includes v10 event types)
- Richer repo cards with interest hints and icon status row
- Command palette (`/`); trending language/topic bars
- Discovery sections powered by `/api/trending/*` (not placeholder links)

Does **not** change ingestion or schema. Can overlap with v12 feature icons on cards.

---

## v12 — Archive Intelligence

Archive becomes searchable beyond metadata. **Two layers** — raw facts, then derived facts.

### Layer 1: Raw facts — `repo_files` (append-only)

Indexed when tarball is archived (already downloaded).

| Column | Notes |
|--------|-------|
| `id` | PK |
| `repo_id` | FK |
| `snapshot_id` | FK → `archive_snapshots` |
| `path` | Relative path in repo |
| `extension` | e.g. `.md`, `.json` |
| `size` | Bytes |
| `content_hash` | Optional SHA-256 |
| `observed_at` | Index time |

### Layer 2: Derived facts — `repo_features` (append-only)

Generic feature system — **not** technology-specific table names. Always derivable from `repo_files`.

| Column | Notes |
|--------|-------|
| `id` | PK |
| `repo_id` | FK |
| `snapshot_id` | FK (which archive run produced this) |
| `feature` | String key |
| `value` | `true`, version string, or JSON detail |
| `observed_at` | When derived |

Example rows:

| feature | value |
|---------|-------|
| `docker` | `true` |
| `github_actions` | `true` |
| `agents_md` | `true` |
| `claude_md` | `true` |
| `bun` | `true` |
| `devcontainer` | `true` |
| `nix` | `true` |
| `vscode` | `true` |
| `mcp` | `true` |

**Rule:** new capabilities = new `feature` keys + path-matching rules in the indexer. No schema migration.

New features can be backfilled by re-scanning `repo_files` without re-downloading archives.

### Unlocks

- Birth-feed / search filters by feature
- *"Repos with `agents_md`"*
- *"Repos with Docker Compose"*
- Input to archaeology milestones (*"Added Docker"*, *"Adopted AGENTS.md"*)

---

## v12.5 — Repository Understanding

Archive Intelligence indexes facts. Repository Understanding explains them.

### Intelligence Report

Each repo gets a structured, reproducible report generated from metadata, snapshots, events, metrics, features, dependencies, and repository state. The report should be readable by a human before they inspect raw data.

| Section | Answers |
|---------|---------|
| Identity | What is this repository? |
| Purpose | Who is it for and what job does it do? |
| Significance | Why might it be worth preserving? |
| Evidence | What has GithubArchive+ saved locally? |
| Technology | What stack/features are detected from source and manifests? |
| Timeline summary | What story do the events tell? |
| Current status | Active, stale, archived, deleted, or deleted-but-preserved |
| Recoverability | Could the repo be reconstructed from local evidence? |

Example report fields:

```text
Identity:
  A SvelteKit application for archiving GitHub repositories and reconstructing historical repository state.

Purpose:
  Designed for developers, researchers, and archivists tracking open-source evolution.

Evidence:
  README archived, source archived, ZIP available, releases archived, timeline reconstructed,
  commit history observed, license history observed, topics history observed.

Technology:
  SvelteKit, SQLite, Node, GitHub Actions, Docker, Bun.
```

### Preservation Score

Add a first-class score answering: *"Why archive this?"*

Inputs should be derived from existing or planned facts:

| Signal | Source |
|--------|--------|
| Rapid weekly growth | v11 metrics |
| High growth percentile | v11 metrics |
| First public release | releases |
| README changed often | `repository_events` |
| Source snapshot saved | `archive_snapshots` |
| Deleted or GitHub-archived | repo metadata |
| Uncommon or newly adopted technology | `repo_features` / dependencies |
| Active contributor or release pattern | metrics, releases, events |

Display as both a number and reasons:

```text
Archive Score: 98/100

Reasons:
- Rapid weekly growth
- First public release
- Documentation changed 8 times
- Repository already archived by owner
- Source snapshot preserved
```

### Recoverability

Add a recoverability report answering: *"If GitHub disappeared tomorrow, how much could we reconstruct?"*

Suggested dimensions:

| Dimension | Evidence |
|-----------|----------|
| README | Latest README snapshot exists |
| Source | Latest source snapshot exists and is readable |
| ZIP | Exportable ZIP snapshot exists |
| Releases | Releases/tags/assets archived |
| Timeline | `repository_events` coverage |
| Commits | `repo_commit_snapshots` coverage |
| License/topics | v10 history tables |
| Dependencies | v13 dependency rows |

Example:

```text
Recoverability:
  README 100%
  Source 100%
  Releases 100%
  Timeline 95%
  Commits 82%
  Dependencies 91%
  Overall 93%
```

### Significance Narratives

Repository Understanding should turn raw events into interpretive statements:

| Raw fact | Better explanation |
|----------|--------------------|
| `readme_changed` | Documentation was substantially rewritten after the first release, suggesting the project matured from prototype to production-ready application. |
| `topics_changed` | The project shifted toward AI tooling by adding `mcp`, `agents`, and `claude` topics after creation. |
| `license_changed` | The repository became more commercially friendly by switching from GPL to Apache-2.0. |
| `deleted_at` with snapshots | The upstream repository disappeared from GitHub, but README/source/history remain preserved locally. |

Implementation should keep a deterministic rule engine first, then allow optional LLM enrichment later. Generated prose must point back to evidence rows so it remains auditable.

---

## v13 — Ecosystem Intelligence

**Only after v12 file index exists.** Feeds Repository Understanding with dependency-level context.

### `repo_dependencies` (append-only)

Normalized rows from manifest parsers (independent per ecosystem):

| Column | Notes |
|--------|-------|
| `repo_id`, `snapshot_id` | Links |
| `ecosystem` | `npm`, `pypi`, `cargo`, `go`, … |
| `package_name` | Normalized |
| `version_constraint` | As declared |
| `observed_at` | Parse time |

Parsers: npm → Python → Rust → Go (incremental).

### Richer queries

- *"TypeScript projects using Bun and MCP"*
- *"Rust repos adopting AI agent workflows"*
- *"Python projects with GitHub Actions but no Docker"*

Combines `repo_features` + `repo_dependencies` + `repo_topics_history`.

---

## Cross-cutting: Repository State

A **service abstraction** (not necessarily a table) that answers:

> *"What did this repository look like on 2026-07-01?"*

### `getRepoState(repoId, asOf: Date)` returns

| Field | Source |
|-------|--------|
| `commit` | Latest `repo_commit_snapshots` where `observed_at ≤ asOf` |
| `license` | Latest `repo_license_history` row ≤ asOf |
| `topics` | Latest `repo_topics_history` row ≤ asOf |
| `metrics` | Latest `repo_metrics_snapshots` row ≤ asOf |
| `readme` | Latest `archive_snapshots` (type readme) ≤ asOf |
| `features` | Latest `repo_features` per key ≤ asOf |
| `dependencies` | Latest `repo_dependencies` ≤ asOf (v13) |

UI and API ask for **state**, not manual joins across history tables.

### Enables

- Compare July vs August
- Repository evolution views
- Export state at a specific date
- Archaeology timeline synthesis

---

## Repository Archaeology

Synthesis layer on preserved + derived data — milestone narrative, not raw event dump.

### Milestones (detected from state changes)

```
Created
  ↓
First README archived
  ↓
First release
  ↓
Added Docker              ← repo_features
  ↓
Adopted AGENTS.md         ← repo_features
  ↓
Reached 100 stars         ← repo_metrics_snapshots
  ↓
Renamed                   ← existing rename flow
  ↓
Switched license          ← repo_license_history
  ↓
Archived / Deleted
```

Store as `repository_events` with `event_type = milestone_*` or optional `repo_milestones` append-only table.

Render as vertical timeline on repo page.

---

## v14 — Repository Memory

Repository Memory is not a larger database; it is better explanation from evidence already preserved. It answers higher-order questions that make the archive feel like an intelligence platform instead of a mirror.

### Questions

- Why did this suddenly become popular?
- Why is this repo important?
- What actually changed?
- Was this a rewrite or a minor edit?
- Is this project abandoned or simply stable?
- How has its purpose evolved?

### Inputs

| Input | Explanation use |
|-------|-----------------|
| README snapshots | Detect major documentation rewrites, positioning changes, install/setup maturity |
| Topics/license history | Explain purpose or licensing shifts |
| Metrics velocity/acceleration | Explain popularity changes |
| Features/dependencies | Explain stack evolution and ecosystem adoption |
| Releases | Explain maturity and production readiness |
| Repository state | Compare what the repo meant at two points in time |

### Outputs

- Purpose evolution summary
- Change significance labels: minor edit, docs rewrite, stack shift, release maturity, licensing shift
- Popularity explanation: growing rapidly, emerging, sleeping giant, stable but maintained
- Abandonment/stability explanation based on releases, pushes, issues, and archive evidence

All memory claims must link back to evidence rows or reconstructed state so the explanation remains auditable.

---

## Later versions (outline)

| Version | Focus |
|---------|-------|
| v14 | Repository Memory: explanation of significance, popularity, purpose evolution |
| v15 | Release analytics (frequency, abandoned score) |
| v16 | Public paginated archive API (`/history`, `/state`, `/trending`) |
| v17 | Performance: covering indexes, incremental FTS, worker queue table |

---

## Schema summary by version

```
v10  repo_commit_snapshots, repo_license_history, repo_topics_history
v11  (views only; optional repo_growth_daily materialized)
v11-ops  migration011: summary, category, daemon_decisions, capture_reason, job_runs.reason
v12  repo_files, repo_features
v12.5  intelligence reports, preservation score, recoverability (derived, rebuildable)
v13  repo_dependencies
—    repo_milestones (optional, archaeology)
```

---

## North-star queries (mapped to versions)

| Query | Needs |
|-------|-------|
| Switched MIT → Apache | v10 |
| Fastest growing this week | v11 |
| Repos with AGENTS.md | v12 |
| Why should this repo be archived? | v12.5 |
| Could this repo be recovered if GitHub disappeared? | v12.5 |
| SvelteKit + Bun + MCP | v12 + v13 |
| Why did this repo become important? | v14 |
| State on 2026-07-01 | v10 + state service |
| Renamed after first release | v10 + archaeology + releases |

---

## UI backlog (by version)

**v10:** license/topic change badges on repo cards; history sections on repo page
**v11:** trending feeds API + velocity badges on cards; growth graphs
**v11.5:** discovery platform UI refresh — see [`UI.md`](./UI.md)
**v12:** feature filters on birth-feed and search
**v12.5:** Intelligence Report, Archive Score, recoverability meter, significance narratives
**v13:** dependency explorer
**v14:** purpose evolution, popularity explanations, rewrite/stability summaries
**Archaeology:** synthesized milestone timeline (uses state service)

---

## Implementation order

1. **v10** — one migration, enrich hooks, event types, basic repo page history
2. **Repository state service** — `getRepoState()` (can ship with v10)
3. **v11** — SQL views + `/api/trending` + minimal trending feed UI
4. **v11-ops** — autonomous daemon, summaries, categories ([`PROPOSAL-autonomous-intelligence.md`](./PROPOSAL-autonomous-intelligence.md); `migration011`)
5. **v11.5** — discovery UI refresh (hero, sidebar, cards — powered by v11 metrics)
6. **v12** — file index in archive worker + feature derivation
7. **v12.5** — Repository Understanding: Intelligence Report, Archive Score, recoverability, significance narratives
8. **Archaeology** — milestone detector + timeline UI
9. **v13** — dependency parsers (npm first)
10. **v14** — Repository Memory: purpose evolution, popularity explanations, significance summaries

---

*Last updated: July 2026 — schema **v10** shipped (historical resolution). **v11** metric definitions locked in [`METRICS.md`](./METRICS.md); Repository Understanding added as the v12.5 product layer.*
