---
id: decision-foundry-v05-complete
date: 2026-07-19
pr: 26
area:
  - tooling
  - automation
type: decision
status: open
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: supersedes
    id: feature-foundry-v05
  - type: related
    id: feature-foundry-standalone
  - type: implemented-by
    id: pr-26
title: Foundry v0.5 is feature-complete — use it, don't expand it
---

## Decision

Foundry **v0.5 is feature-complete** for the original goal: replace ChatGPT ↔ Cursor copy/paste with a standalone orchestrator that can create and manage projects.

Local acceptance is green (scaffold → verify → git commit → approval gate → registry → restart). Remote GitHub create is blocked only by the cloud agent token lacking `createRepository` — not by product gaps.

## Do next (human)

1. Publish `TRYINGTHINGSYO/Foundry` via `PUBLISH.md` on `foundry-standalone`
2. Run `FOUNDRY_ACCEPTANCE_GITHUB=1 npm run acceptance:github`
3. Build three real projects with Foundry; fix only friction that shows up
4. Prefer polish (progress, recovery, startup, logs, approval UX, docs) over new AI/marketplace features

## Explicit non-goals right now

Do not expand agents, marketplace, or major capabilities before real usage. GithubArchiver remains an ordinary managed project.
