---
id: validation-semantic-production-readiness
date: 2026-08-20
area:
  - search
type: research
status: open
confidence: confirmed
durability: release
schema: 1
relationships:
  - type: related
    id: feature-semantic-search-turbovec
  - type: related
    id: pr-33
title: MiniLM + TurboVec production-readiness validation (10k representative corpus)
---

## What

Ran production-readiness validation for PR #33 against a 10k GithubArchiver-shaped corpus (no production DB available). MiniLM-L6-v2 + TurboVec 2-bit.

Key outcomes: semantic/hybrid strongly beat keyword on 25 discovery queries; restart/removal durable; filters leak-free; 2-bit keeps near-exact labeled recall; recommend GO behind feature flag with private Railway worker; do not change default weights yet; do not merge on this alone without a production-snapshot dry-run.

Artifacts: `docs/semantic-prod-readiness/REPORT.md`, `results.json`, `npm run semantic:prod-readiness`.

## Remaining

- Re-run against a real production snapshot before flipping the flag in prod
- Watch hybrid lexical dilution on meaning queries
