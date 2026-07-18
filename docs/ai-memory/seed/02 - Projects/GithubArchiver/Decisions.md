---
status: active
project: githubarchiver
type: decisions
---

# Decisions

Treat these as authoritative unless Blake revises them.

## Discovery

- **GH Archive is primary.** Search runs only to fill gaps (e.g. hours with zero matched repository creates), not as the default scanner.
- **Matched repo creates, not raw event counts**, gate Search fallback (migration 030 / `matched_repo_creates`). After ~2025-10, GH Archive CreateEvents often lack `ref_type=repository`; matching uses default-branch CreateEvents.
- Skip Search when a prior Search pass for that hour already reconciled mostly-known repos (≥95% skip ratio).

## Daemon / backlog

- Enrichment backlog must not monopolize the planner over ingest.
- Backlog sleep uses `min(sleepMinMs, ARCHIVE_BACKLOG_SLEEP_MS)` (not a multi-minute stall by default).

## Status semantics

- Activity bar separates **current activity** from **progress** (`enriched · this run · waiting`).
- Restart-orphaned jobs are **`interrupted`**, not `failed`.
- **Search fallback active** means Search is currently executing — not that historical Search discoveries exist.
- Stale `search_ingest_stats` / job rows after Railway restart must be reconciled (same orphan age window).

## Testing

- Production failure modes get regression tests (including daemon startup reconcile for Search shards).
- Do not “fix” stale-state bugs only by changing UI copy.
