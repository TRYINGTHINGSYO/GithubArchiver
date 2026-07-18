---
id: feature-foundry-product
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
    id: feature-gpt-cursor-orchestrator-v04
  - type: implemented-by
    id: pr-26
title: Rename to Foundry — task graphs, product readiness, marketplace seed
---

## What

Productized the orchestrator as **Foundry** (`tools/foundry`), not “GPT Cursor Relay”.

- **Rename** — package `foundry`, CLI `bin/foundry.js`, config `foundry.config.yaml`, home `~/.foundry` (legacy relay paths still accepted)
- **Task Graph** — planner steps → DAG with `dependsOn`; ready nodes execute (parallel when independent); per-node verify; retry failed branch only
- **Production readiness** — `foundry setup` / `doctor` / `diagnostics`, AES-256-GCM API-key vault, `create-foundry` bootstrap, update-check hook (`FOUNDRY_UPDATE_URL`)
- **Multi-agent** — registry detects Cursor / Claude Code / Codex / Gemini / Aider (Cursor adapter live; others stubs)
- **Marketplace** — local plugin catalog + install stubs; UI + `/api/marketplace`

## Why

Architecture was already compelling; remaining work is installability, trust, and extensibility. Cursor becomes one adapter, not the product identity.

## Tests

`npm --prefix tools/foundry test` — 39 passing (includes task-graph + secrets vault).

## Remaining

- Real Claude Code / Codex / Gemini / Aider adapters (execute, not only detect)
- Published `npm create foundry` package (scaffold exists under `tools/create-foundry`)
- Remote marketplace registry + signed plugins
- Cross-platform installer polish (Windows PATH / Cursor CLI auto-install)
