---
status: active
project: githubarchiver
type: architecture
---

# Architecture

## Pipeline stages (keep distinct in UI and code)

1. **Discovery** — find new repositories (GH Archive primary; Search fallback)
2. **Ingestion** — record creation signals / hour state
3. **Enrichment** — hydrate repo metadata from GitHub API
4. **Clustering / scoring** — Interesting Score, themes, Archive Stories
5. **Preservation** — archive snapshots / evidence retention

## Runtime

- In-process background daemon (`background-daemon.ts`) picks actions via `daemon-planner.ts`
- Jobs tracked in `job_runs`; Search shards in `search_ingest_stats`
- On process start: reconcile orphaned `job_runs` and orphaned Search stats

## Status hierarchy (shared UI)

```text
Current activity → Progress → Discovery
```

Discovery metrics order:

1. Latest completed archive hour
2. Archive backlog
3. Worker last ran
4. Search fallback

## Primary code anchors

- Daemon: `src/lib/server/background-daemon.ts`
- Planner: `src/lib/server/daemon-planner.ts`
- GH Archive: `src/lib/server/gharchive.ts`
- Search fallback: `src/lib/server/repo-discovery.ts`, `src/lib/server/db/search-ingest.ts`
- Status UI: `src/lib/components/StatusStory.svelte`, `src/lib/components/ActivityStatusBar.svelte`
- Client-safe labels: `src/lib/status-display.ts`
