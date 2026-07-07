# Proposal: Autonomous Daemon, Snapshot Export, Repo Summaries & Category Balancing

**Status:** Draft — pending review  
**Schema:** `migration011` (schema_version 11). Note: v10 is already shipped (commit/license/topic history); v11 is separately reserved for trending metrics per [`METRICS.md`](./METRICS.md) (views-only). This proposal is a parallel milestone — track it as **v11-ops** and merge to v12 if the numbering needs to stay linear.

---

## 1. Problem statement

Today the daemon (`background-daemon.ts`) runs a fixed sequence — ingest → enrich → refresh → archive → sleep — regardless of backlog size. It sleeps the full `DAEMON_SLEEP_MIN_MS`–`DAEMON_SLEEP_MAX_MS` window even when thousands of repos are waiting on enrichment. Snapshot export is read-only (`/api/snapshots/[id]` serves existing files but never generates new ones on demand). Repos have no generated summary or content-based category, so there's no way to see or correct discovery imbalance (e.g. way too many of one repo type, almost none of another).

## 2. Architecture fit (current state)

| Area | Today | Gap |
|------|-------|-----|
| Daemon | Fixed sequence, sleeps full interval regardless of backlog | No backlog-aware priority |
| Archive | `listEnrichedReposForArchive()` already targets all enriched repos, oldest snapshot first | Throughput-limited (`ARCHIVE_MAX_REPOS=10`); no on-demand generation |
| `job_runs` | `detail_json` blob only | No first-class `reason` column |
| `repos` | GitHub `description` only | No generated `summary` or `category` |
| `repo-discovery.ts` | Time-window `created:…` sharding only | No category balancing |

## 3. `migration011` SQL

```sql
-- schema_version 11

-- 1) Daemon / job observability
ALTER TABLE job_runs ADD COLUMN reason TEXT;
-- Human-readable one-liner: "6000 unenriched, 0 stale → enrich batch"
-- Structured decision stays in detail_json: { action, scores, backlog }

CREATE INDEX IF NOT EXISTS idx_job_runs_reason ON job_runs(reason)
  WHERE reason IS NOT NULL;

-- 2) Repo intelligence (persisted at enrich time)
ALTER TABLE repos ADD COLUMN summary TEXT;
ALTER TABLE repos ADD COLUMN summary_generated_at TEXT;
ALTER TABLE repos ADD COLUMN category TEXT;            -- controlled vocabulary
ALTER TABLE repos ADD COLUMN category_confidence REAL; -- 0.0–1.0
ALTER TABLE repos ADD COLUMN classified_at TEXT;

CREATE INDEX IF NOT EXISTS idx_repos_category ON repos(category);
CREATE INDEX IF NOT EXISTS idx_repos_classified_at ON repos(classified_at);

-- 3) Snapshot provenance (daemon vs on-demand export)
ALTER TABLE archive_snapshots ADD COLUMN capture_reason TEXT NOT NULL DEFAULT 'daemon';
-- Values: 'daemon' | 'on_demand' | 'export'

CREATE INDEX IF NOT EXISTS idx_archive_snapshots_capture
  ON archive_snapshots(repo_id, snapshot_type, capture_reason, archived_at DESC);

-- 4) Category distribution history (append-only, for gap detection)
CREATE TABLE IF NOT EXISTS repo_category_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at TEXT NOT NULL,          -- UTC day boundary ISO
  category TEXT NOT NULL,
  repo_count INTEGER NOT NULL,
  pct_of_total REAL NOT NULL,
  UNIQUE(observed_at, category)
);

CREATE INDEX IF NOT EXISTS idx_repo_category_daily_observed
  ON repo_category_daily(observed_at DESC);

-- 5) Daemon decision log
CREATE TABLE IF NOT EXISTS daemon_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decided_at TEXT NOT NULL,
  action TEXT NOT NULL,               -- ingest|enrich|refresh|archive|backfill|search_gap|idle
  reason TEXT NOT NULL,
  backlog_json TEXT NOT NULL DEFAULT '{}',
  job_run_id INTEGER REFERENCES job_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_daemon_decisions_at ON daemon_decisions(decided_at DESC);
```

**Controlled `category` vocabulary** (enforce in app code, not a SQLite CHECK, for flexibility):

`bot` · `library` · `cli-tool` · `web-app` · `mobile-app` · `game` · `data-ml` · `devops` · `docs-site` · `template` · `other`

## 4. Daemon priority planner

New module: `src/lib/server/daemon-planner.ts`

```typescript
type DaemonAction =
  | 'ingest'
  | 'search_gap'
  | 'backfill'
  | 'enrich'
  | 'refresh'
  | 'archive'
  | 'idle';

interface BacklogSnapshot {
  missingGhArchiveHours: number;
  currentHourSearchGap: boolean;   // GH Archive hour done but search fallback not run
  backfillPendingHours: number;
  unenriched: number;
  staleRefresh: number;            // last_checked_at older than REFRESH_INTERVAL_HOURS
  unarchivedSource: number;        // enriched, no source tarball snapshot
  rateLimitedUntil: string | null;
}

function score(action: DaemonAction, b: BacklogSnapshot): number {
  switch (action) {
    case 'ingest':
      return b.missingGhArchiveHours > 0 ? 100 + b.missingGhArchiveHours : 0;
    case 'backfill':
      return b.backfillPendingHours > 0 ? 90 + b.backfillPendingHours : 0;
    case 'search_gap':
      return b.currentHourSearchGap ? 85 : 0;
    case 'enrich':
      return b.unenriched > 0 ? 80 + Math.log10(b.unenriched + 1) * 10 : 0;
    case 'refresh':
      return b.staleRefresh > 0 ? 50 + Math.log10(b.staleRefresh + 1) * 8 : 0;
    case 'archive':
      return b.unarchivedSource > 0 ? 40 + Math.log10(b.unarchivedSource + 1) * 6 : 0;
    case 'idle':
      return 0;
  }
}

function pickAction(b: BacklogSnapshot): { action: DaemonAction; reason: string } {
  if (b.rateLimitedUntil && Date.now() < Date.parse(b.rateLimitedUntil)) {
    return { action: 'idle', reason: `GitHub rate limit until ${b.rateLimitedUntil}` };
  }

  const candidates: DaemonAction[] = [
    'ingest', 'backfill', 'search_gap', 'enrich', 'refresh', 'archive'
  ];
  const ranked = candidates
    .map((a) => ({ action: a, score: score(a, b) }))
    .sort((x, y) => y.score - x.score);

  const best = ranked[0];
  if (!best || best.score === 0) {
    return { action: 'idle', reason: 'All queues empty' };
  }

  return {
    action: best.action,
    reason: formatReason(best.action, b)  // e.g. "6,231 unenriched, 0 stale → enrich"
  };
}
```

**Loop change** (`background-daemon.ts`):

```text
each cycle:
  b = queryBacklogSnapshot()
  { action, reason } = pickAction(b)

  decisionId = insertDaemonDecision(action, reason, b)
  childJobId = startJobRun(action, { backlog: b, parent: daemonJobId })
  updateJobRun(childJobId, { reason })

  switch (action):
    ingest       → runIngestCycle()
    search_gap   → runSearchGapForCurrentHour()
    backfill     → runBackfillBatch(1)
    enrich       → runEnrichCycle()
    refresh      → runRefreshCycle()
    archive      → runArchiveCycle()
    idle         → sleep(SLEEP_MIN_MS) only

  if any backlog queue non-empty after run:
    sleep(SLEEP_MIN_MS)
  else if hadFailure:
    sleep(rateLimitWaitMs(...))
  else:
    sleep(randomSleepMs())   // full idle backoff only when truly empty
```

**New backlog query** (add to `db/admin-stats.ts` or `daemon-planner.ts`):

```sql
-- unarchived source tarballs
SELECT COUNT(*) FROM repos r
WHERE r.enriched_at IS NOT NULL AND r.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM archive_snapshots a
    WHERE a.repo_id = r.id AND a.snapshot_type = 'source'
  );
```

`/admin/jobs` UI: show the new `reason` column; expand `detail_json.backlog` for per-action scores.

## 5. Snapshot export behavior

The archive worker already persists tarballs for enriched repos. The real gaps are:

1. **On-demand export** — `GET /api/snapshots/[id]` is read-only; no generation path.
2. **Provenance** — no way to distinguish daemon capture vs export-triggered capture.

```text
GET /api/snapshots/[id]
  → if row exists and file on disk: serve (unchanged)

GET /api/repo/:owner/:repo/export?type=source|readme
  → if latest snapshot missing or head_sha stale:
       archiveRepo(repo, { capture_reason: 'export' })
     → redirect or stream latest snapshot id
```

`insertArchiveSnapshot()` gains `capture_reason`. Daemon path passes `'daemon'`; export path passes `'export'`. Do **not** duplicate tarball logic in the API handler — call the existing `archiveRepo()` from `archiver.ts`.

## 6. Summary & classification hooks (`enrich.ts`)

```text
enrichRepo() / refreshRepo()
  ├─ fetchRepoMetadata()          [existing]
  ├─ saveEnrichment()             [existing]
  ├─ recordRepoHistoryChanges()   [existing v10]
  ├─ insertMetricSnapshot()       [existing]
  ├─ summarizeRepo(repo, ctx)     [NEW — after metadata saved]
  │     inputs: description, language, topics, readme text (if archived),
  │              optional tarball file list (if source snapshot exists)
  │     output: summary string (≤ 280 chars) → repos.summary
  └─ classifyRepo(repo, ctx)      [NEW — after summarize]
        rule-based first (no LLM required for v1):
          - bot: name ends with -bot, topics contain bot, empty README + high fork ratio
          - cli-tool: package.json bin / cmd/ / main.go / pyproject [project.scripts]
          - library: no README install section, src/lib structure, low entrypoints
          - web-app: package.json deps react/svelte/next, Dockerfile, public/
          - game: godot, unity, love2d paths
          - data-ml: notebooks, datasets/, pytorch/tensorflow deps
        fallback: other
        writes repos.category, category_confidence, classified_at
```

**New files:**

- `src/lib/server/summarize-repo.ts` — pure functions + optional README truncation
- `src/lib/server/classify-repo.ts` — rules engine; a later `repo_files`/`repo_features` schema can replace the tarball peek with something finer-grained
- `src/lib/server/category-stats.ts` — daily rollup → `repo_category_daily`

**Re-classify policy:** v1 re-runs classification every enrich cycle; a later `classification_input_hash` can gate re-runs to only when README/source hash actually changes.

## 7. Gap-aware discovery

```typescript
function underrepresentedCategories(
  daily: { category: string; pct_of_total: number }[],
  thresholdPct = 1.0
): string[] {
  return daily.filter((r) => r.pct_of_total < thresholdPct).map((r) => r.category);
}
```

**Search query templates** (new in `repo-discovery.ts`, additive to existing time sharding):

| Category | GitHub Search qualifier (examples) |
|----------|-----------------------------------|
| `cli-tool` | `topic:cli` OR `topic:command-line` |
| `game` | `topic:game` OR `topic:godot` |
| `data-ml` | `topic:machine-learning` |
| `devops` | `topic:devops` OR `topic:kubernetes` |

```text
ingestReposFromSearch(hourKey):
  gaps = getUnderrepresentedCategories()   // latest repo_category_daily row
  if gaps.length > 0:
    pick = gaps[hourIndex % gaps.length]
    run supplementary query: `${hourCreatedSearchQuery(hourKey)} ${qualifierFor(pick)}`
  always run base hour query (existing behavior)
```

Log supplementary queries in `search_ingest_stats` with `detail_json.category_target`.

## 8. Persistence checklist

| Artifact | Storage |
|----------|---------|
| Daemon decision | `daemon_decisions` + `job_runs.reason` |
| Summary | `repos.summary` |
| Category | `repos.category` |
| Snapshot provenance | `archive_snapshots.capture_reason` |
| Category distribution | `repo_category_daily` (append daily) |
| Nothing transient in `/admin` | all aggregates read from SQLite |

## 9. Suggested implementation order

```text
1. migration011 + backlog queries + daemon-planner
2. job_runs.reason + /admin/jobs UI
3. capture_reason + export endpoint
4. summarize-repo + classify-repo hooks in enrich.ts
5. category-stats daily job + discovery weighting
6. Tests: planner picks enrich when unenriched >> stale; classification golden files
```

**Explicitly deferred:** LLM-generated summaries (v1 is rule/template-based), and a future `repo_features` table for fine-grained (non-category) tagging.

## 10. Roadmap collision note

| Track | Milestone | Schema |
|-------|-----------|--------|
| Trending velocity | v11 per [`METRICS.md`](./METRICS.md) | views only (optional materialized table) |
| This proposal | **v11-ops** / ops intelligence | `migration011` columns + tables |
| Discovery UI | v11.5 per [`ROADMAP.md`](./ROADMAP.md) | none |
| File-based features | v12 | `repo_files`, `repo_features` |

---

*Last updated: July 2026*
