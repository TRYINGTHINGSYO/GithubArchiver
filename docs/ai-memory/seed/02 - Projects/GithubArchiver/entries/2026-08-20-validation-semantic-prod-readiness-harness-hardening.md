---
id: validation-semantic-prod-readiness-harness-hardening
date: 2026-08-20
pr: 33
commit: ff30ae7
area:
  - search
type: research
status: open
confidence: confirmed
durability: release
schema: 1
relationships:
  - type: supersedes
    id: validation-semantic-production-readiness
  - type: related
    id: feature-semantic-search-turbovec
  - type: implemented-by
    id: pr-33
title: Prod-readiness harness hardened (latency, worker RSS, filters, noise)
---

## What

Hardened `npm run semantic:prod-readiness` before any production-snapshot gate:

- Independent keyword / semantic / hybrid latency (cold + warm p50/p95/mean; 40 warm iters)
- Python worker process-tree RSS (after model load / peak index / after index / query load); Railway sized from worker peak
- Honest indexing: `index_batch_wall_s` + worker `embedMs`/`upsertMs` + `sync_wall_s` (no synthetic upsert %)
- Full per-row filter assertions including cluster/date/readme/release/archived + soft-max post-filter proof; leaks fail the run
- Deterministic harder near-miss noise (35 templates); 25-query re-eval
- Runtime `.tvim` / worker logs / `bit-eval-input.json` removed from git

## Measured (10k representative corpus)

- Worker peak RSS ≈ **948 MB** → suggest **4 GB** Railway RAM (not 2 GB)
- Semantic R@10 ≈ 0.66 / MRR ≈ 0.79; keyword R@10 ≈ 0.10 / MRR ≈ 0.20; 0 keyword>semantic MRR regressions
- Hybrid warm p95 ≈ 52 ms on this host
- Verdict still `GO_BEHIND_FEATURE_FLAG` on synthetic corpus only

## Remaining

- Final gate: same harness READ-ONLY against a real production snapshot (no DB mutation)
- Do not merge PR #33 on synthetic results alone
- Do not retune production ranking weights from this set
