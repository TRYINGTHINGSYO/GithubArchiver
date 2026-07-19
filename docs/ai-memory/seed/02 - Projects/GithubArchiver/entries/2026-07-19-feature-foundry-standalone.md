---
id: feature-foundry-standalone
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
    id: feature-foundry-ux-trust
  - type: implemented-by
    id: pr-26
  - type: related
    id: feature-foundry-product
title: Extract Foundry to standalone product (retire tools/foundry)
---

## What

Foundry is no longer developed under `tools/foundry`. The package was subtree-split and extended as a standalone root (`src/`, `public/`, `plugins/`, `adapters/`) with:

- Landing: create / open / resume
- Staging scaffold → verify → destination
- `~/.foundry` project registry
- Approval-gated GitHub repo creation
- No GithubArchiver imports or hardcoded known projects

## Where the code lives

- Intended remote: `TRYINGTHINGSYO/Foundry` (create via account with org `createRepository`; the cloud agent token could not create it)
- Interim: branch `foundry-standalone` on GithubArchiver (full extracted tree + new commits)
- History: branch `foundry-split` (`git subtree split --prefix=tools/foundry`)

## GithubArchiver change

`tools/foundry` is replaced by a pointer README. Root `npm run foundry*` scripts redirect to clone instructions. GithubArchiver is an ordinary managed project to register in Foundry.

## Tests

Standalone suite: 55 passing (`npm test` in Foundry / `foundry-standalone`).

## Remaining

1. Create `TRYINGTHINGSYO/Foundry` and push `foundry-standalone` (or `/home/ubuntu/Foundry`) as `main`
2. Optionally delete interim branches after the new remote exists
3. Publish / global install (`npx foundry`) later — not in this extraction
