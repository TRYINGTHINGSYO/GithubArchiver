---
id: feature-foundry-v05
date: 2026-07-19
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
    id: feature-foundry-standalone
  - type: implemented-by
    id: pr-26
title: Foundry v0.5 — build/dist, CI, self-boundary (awaiting org repo)
---

## What

Foundry **v0.5.0-beta.1** on branch `foundry-standalone`:

- `npm run build` → `dist/`; `npm start` = `node dist/index.js` (no tsx at runtime)
- CLI loads `dist/` with src/tsx fallback only when unbuilt
- GitHub Actions CI: ci → typecheck → test → build (+ health smoke)
- Self-project boundary when opening Foundry itself (plan/push/dependency/deploy/self-update approvals; trust capped at `safe_edits`)
- Setup prompts for `gh auth login` and documents approval-gated remote create
- `PUBLISH.md` with remote-safe `gh repo create` flow

## Tests

59 passing; production health smoke returns `standalone: true`, version `0.5.0-beta.1`.

## Blocked on human

Cloud agent token cannot `createRepository`. Owner must run `PUBLISH.md` to create `TRYINGTHINGSYO/Foundry` and push `main`.

## Acceptance (v0.5)

Natural-language idea + empty destination → verified committed project → one remote approval → private GitHub repo. Keep `private: true` until clean-machine beta checks.
