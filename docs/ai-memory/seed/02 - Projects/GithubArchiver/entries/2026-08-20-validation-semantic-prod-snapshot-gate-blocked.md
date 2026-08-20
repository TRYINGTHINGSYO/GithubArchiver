---
id: validation-semantic-prod-snapshot-gate-blocked
date: 2026-08-20
pr: 33
commit: b1426aa
area:
  - search
type: research
status: open
confidence: confirmed
durability: release
schema: 1
relationships:
  - type: related
    id: validation-semantic-prod-readiness-harness-hardening
  - type: related
    id: feature-semantic-search-turbovec
  - type: implemented-by
    id: pr-33
title: Production-snapshot gate blocked — no prod DB copy available
---

## What

Implemented `npm run semantic:prod-snapshot-gate` for the PR #33 final gate:

- Requires `SEMANTIC_PROD_SNAPSHOT_SOURCE` + ACK
- Always copies source → temp work DB; fingerprints source size/mtime/ino before/after
- Builds only temporary TurboVec indexes under `/tmp`
- Full path covers inventory, 2-bit/4-bit index, ≥50-query review pack, filters, latency, RSS, restart

Railway MCP/CLI unavailable in this environment. **No production SQLite copy was supplied.**

Safety proof (`--safety-proof`) passed: copy→open→inventory with source unchanged. That proof does **not** pass the production gate.

## Verdict

**NO_GO** — `BLOCKED_NO_PRODUCTION_SNAPSHOT`. Do not merge. Do not claim production validation.

## Operator artifact needed

Non-writable copy/backup of production `DATABASE_PATH` SQLite file, then:

```bash
SEMANTIC_PROD_SNAPSHOT_SOURCE=/absolute/path/to/prod-copy.db \
SEMANTIC_PROD_SNAPSHOT_ACK=I_CONFIRM_THIS_IS_A_NON_PRODUCTION_COPY \
npm run semantic:prod-snapshot-gate
```
