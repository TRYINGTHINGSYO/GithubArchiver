---
id: feature-gpt-cursor-orchestrator-v03
date: 2026-07-18
pr: 26
area:
  - tooling
  - automation
type: feature
status: open
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: supersedes
    id: feature-gpt-cursor-relay-v15
  - type: implemented-by
    id: pr-26
title: GPT ↔ Cursor orchestrator v0.3
---

## What

Upgraded `tools/gpt-cursor-relay` into an AI software engineering orchestrator (v0.3).

## Capabilities

1. Parallel Cursor agents via git worktrees + merge instruction
2. Automatic verification (`npm test` / build / lint) + GPT verify opinion
3. Optional browser HTTP smoke checks
4. Git intelligence (theme, risk, breaking, migration)
5. Planning mode with Approve Plan gate
6. One-click rollback from pre-run git checkpoint
7. Long-term project conversation memory on disk
8. Coding style preference learning
9. Supervisor mode — redirect/stop Cursor mid-activity on sensitive edits

## Tests

`npm --prefix tools/gpt-cursor-relay test` — 27 passing.
