---
id: feature-cursor-memory-rules
date: 2026-07-18
pr: 7
commit: 5cc586d
area:
  - memory
type: feature
status: merged
confidence: confirmed
supersedes: null
related:
  - pr-8
  - pr-9
  - memory
title: Cursor Project Rules + AI memory seed vault
migration: null
---

# PR #7 — Cursor AI memory bootstrapping

- `.cursor/rules/`: memory-system, githubarchiver-context, session-checkpoint
- Seed vault under `docs/ai-memory/seed/` for copy into `C:\AI-Memory`
- Portable vault resolution: `AI_MEMORY_VAULT` → `C:\AI-Memory` → `$HOME/AI-Memory`
- Durable checkpoints only — no forced daily-note diaries
