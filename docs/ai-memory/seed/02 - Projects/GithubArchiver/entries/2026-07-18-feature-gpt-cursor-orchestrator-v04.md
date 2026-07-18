---
id: feature-gpt-cursor-orchestrator-v04
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
    id: feature-gpt-cursor-orchestrator-v03
  - type: implemented-by
    id: pr-26
title: Orchestrator v0.4 — reliability platform
---

## What

Shifted from feature expansion to reliability/modularity for `tools/gpt-cursor-relay`.

## Rock-solid foundations

1. Plugin architecture (built-ins + external `plugin.json` / JS modules)
2. Per-project approval policy YAML
3. `CodingAgent` interface with Cursor adapter
4. Structured execution timeline
5. Crash recovery sessions on disk + Resume API/UI
6. Metrics dashboard (success rate, rounds, cost, stop reasons)
7. Parallel-worker file conflict detection before merge

## Tests

`npm --prefix tools/gpt-cursor-relay test` — 35 passing.
