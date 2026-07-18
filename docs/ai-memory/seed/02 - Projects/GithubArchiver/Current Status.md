---
status: active
project: githubarchiver
type: status
---

# Current Status

## 2026-07-18 — Status semantics + Search active accuracy

### Merged on `main`

- **PR #2** — backlog sleep + enrichment tiers
- **PR #3** — GH Archive CreateEvent matching / search-gap gating (`matched_repo_creates`)
- **PR #4** — activity bar copy prefers enrichment messaging when backlog remains
- **PR #5** — shared status hierarchy (`StatusStory`), interrupted orphans, clarified discovery labels

### Open

- **PR #6** — Search fallback active reflects live execution only  
  https://github.com/TRYINGTHINGSYO/GithubArchiver/pull/6  
  - Root cause: Railway restart left `search_ingest_stats.status='running'`; jobs reconciled, Search shards did not  
  - Fix: reconcile orphaned Search stats on daemon start; age-floor in `isSearchFallbackActive`  
  - Discovery order polish: archive hour → archive backlog → worker last ran → Search fallback  
  - Tests: `tests/search-fallback-active.test.ts` including `ensureBackgroundWorker` e2e startup path  
  - State: open, draft, mergeable (as of last check)

### Verified in production after PR #5

- Activity bar: Current activity + Progress (`enriched · this run · waiting`) — good
- Shared hierarchy on homepage — good
- Discovery labels (latest archive hour / backlog / worker last ran) — good
- Search fallback showed **Yes** during enrichment — investigated as stale Search shard state → PR #6

### Remaining verification (after PR #6 deploy)

| Scenario | Search fallback |
| --- | :---: |
| Normal GH Archive ingest | No |
| Ordinary enrichment | No |
| Search fallback actually executing | Yes |
| Stale Search rows after Railway restart | No (reconciled or aged out) |

### Ops note (not a code fix)

- Production needs a real `GITHUB_TOKEN` on Railway for API-backed enrichment/Search.

## Memory system (this repo)

- Cursor Project Rules added under `.cursor/rules/`
- Seed vault notes under `docs/ai-memory/seed/` for copy into `C:\AI-Memory`
