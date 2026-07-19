---
id: feature-foundry-ux-trust
date: 2026-07-19
pr: 26
area:
  - tooling
  - automation
  - ux
type: feature
status: open
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: supersedes
    id: feature-foundry-product
  - type: implemented-by
    id: pr-26
title: Foundry UX + trust-boundary refinement (no new features)
---

## What

Stopped adding capabilities; redesigned Foundry around clarity and hard safety boundaries.

- **Run screen** answers four questions: doing / working / needs me / changed
- **Tabs** hold Overview, Task Graph, Changes, Verification, Timeline, Logs, Project Intelligence
- **ACTION REQUIRED** banner with Approve once / Approve for run / Deny
- **Completion report** with confidence, verification evidence, follow-ups as *new runs only*
- **Task graph cards** with worker, duration, files, retry
- **Trust levels** (`read_only` → `full_automation`) in config + UI
- **Execution policy gate** for verify/plugin commands + instruction gate before agent runs
- **Credentials** renamed to “locally encrypted credential file”; OS store abstraction stub
- **Rollback preview** before undo

## Why

Product design and trust boundaries matter more than more intelligence. Marketplace / new agents deliberately not expanded.

## Tests

`npm --prefix tools/foundry test` — 47 passing (policy, confidence, credentials, trust-block).
