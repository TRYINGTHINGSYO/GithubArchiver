---
id: validation-semantic-prod-snapshot-gate-result
date: 2026-08-20
pr: 33
commit: 524ee3b
area:
  - search
type: research
status: open
confidence: confirmed
durability: release
schema: 1
relationships:
  - type: supersedes
    id: validation-semantic-prod-snapshot-gate-blocked
  - type: related
    id: validation-semantic-prod-readiness-harness-hardening
  - type: implemented-by
    id: pr-33
title: Production-snapshot gate result — GO_MERGE_KEEP_FLAG_OFF
---

## What

Ran READ-ONLY production-snapshot gate against a consistent SQLite backup of Railway project `new` / volume `new-volume` (`DATABASE_PATH=/data/githubarchive.db`).

Export method: remote `sqlite3.Connection.backup()` to container `/tmp` (not the volume), gzip stream to `/workspace/data/prod-snapshot-copy.db`. Source fingerprint unchanged. Temporary TurboVec indexes only.

## Measured

- Corpus: 816,347 repos; 46,360 eligible; enriched 46,371; deleted 1,543
- Indexed 46,360 @ 2-bit and 4-bit; 0 failures
- Worker peak RSS ≈ 1084 MB → suggest 4 GB / 1 vCPU
- Hybrid warm p95 ≈ 58 ms (2-bit) / 58 ms (4-bit)
- Restart/removal durable on temp indexes
- Filters leak-free after correcting multi-cluster `any` assertion false positive
- Chosen bits: **4** (mean semantic top-10 overlap vs 2-bit ≈ 0.76; ~1.9× disk; negligible latency delta)

## Verdict

**GO_MERGE_KEEP_FLAG_OFF** — architecture/correctness/durability OK on real archive; do not enable the feature flag until a human reviews `docs/semantic-prod-snapshot/HUMAN_REVIEW.md`. Do not auto-merge.

## Remaining

- Human review of 80-query pack before `GO_MERGE_AND_ENABLE_BEHIND_FLAG`
- README archive bodies not present beside DB copy
- Optional: rotate any tokens that appeared in CLI variable listings during discovery
